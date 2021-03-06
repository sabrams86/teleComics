var express = require('express');
var router = express.Router();
var bcrypt= require('bcrypt');
var db = require('monk')(process.env.MONGOLAB_URI);
var users = db.get('users');
var comics = db.get('comics');
var transcomics = db.get('transcomics');
var helpers = require('../lib/logic');
var sendgrid = require('sendgrid')(process.env.SENDGRIDAPIKEY);

var bt = require('bing-translate').init({
    client_id: process.env.TRANSLATE_ID,
    client_secret: process.env.TRANSLATE_SECRET
  });

router.get('/telecomics',function (req, res, next) {
  res.redirect('/');
})

//NEW
router.get('/telecomics/new', function (req, res, next) {
  res.render('new');
})

//CREATE
router.post('/telecomics', function (req, res, next) {
  var comicMaster
  console.log(req.body)
  var errors = helpers.validateComic(req.body);
  if (errors.length > 0){
    res.render("new", {errors: errors, data: req.body});
  } else {
    var panes = helpers.createPanes(req.body);
    comics.insert({title:req.body.title, panes:panes, owner_id:req.session.uId}).then(function (comic) {
      comicMaster = comic
      users.update({_id: req.session.uId}, {$push: {created: comic._id}})
      res.redirect('/telecomics/'+comicMaster._id+'/preview');
    })
  }
});


router.get('/telecomics/:id/preview', function (req, res, next) {
  comics.findOne({_id: req.params.id}).then(function (comic) {
    res.render('preview', {comic: comic});
  });
});

router.post('/telecomics/:id/send',function (req, res, next) {
  var emails = helpers.emailArray(req.body.recipients);
  var error = helpers.validateEmails(emails);
  var comicMaster = {};
  if(error){
    comics.findOne({_id: req.params.id}).then(function (comic) {
      res.render('preview', {error:error, comic:comic});
    });
  }else{
    var comicMaster = {}
    comics.findOne({_id:req.params.id}).then(function (comic) {
      var paneBlurbs = [];
      var languageRoutes = []
      for (var i = 0; i < comic.panes.length; i++) {
        paneBlurbs.push(helpers.telephoneTranslate(comic.panes[i].comment));
        // languageRoutes.push(helpers.telephoneTranslate(comic.panes[i].comment).languageRoutes)
      }
      comicMaster = comic
      Promise.all(paneBlurbs).then(function (blurbs) {
        blurbArray = []
        blurbs.forEach(function (blurb) {
          blurbArray.push(blurb.blurb)
          languageRoutes.push(blurb.languageRoute)
        });
        var unread = emails.map(function (email) {
          var str = email.toString()
          var obj = {}
          obj.email = email;
          obj.read = false;
          return obj;
        })
        return transcomics.insert({comicId: req.params.id, sentTo: emails, date: Date.now(), 
          blurbs: blurbArray, languages: languageRoutes, owner: req.session.uId, unread: unread,});
      }).then(function (record) {
        var userCreate = [];
        record.sentTo.forEach(function (email) {
          userCreate.push(users.update({email: email}, {$set: {email: email}}, {upsert:true}))
        })
        Promise.all(userCreate).then(function () {
          users.update({email: {$in: record.sentTo}}, {$push: {received: record._id}}, {multi: true})
        })
        users.update({_id: req.session.uId}, {$push: {sent: record._id}})
        users.findOne({_id: req.session.uId}).then(function (user) {
          var email = new sendgrid.Email({
          from:     user.email,
          subject:  comicMaster.title,
          text:     'view your teleocomic online at /telecomics/' + record._id
          });
          email.setHtml('<p>You have been sent a TeleComic!!!!!</p><p>TeleComics is a site where users can create three panel comics with silly comments and translate them through five different languages before sending them to your friends! Click on the link to see the comic sent to you by another user.</p><p><a href="'+process.env.HOST+'/telecomics/'+record._id+'/public">View your comic</a></p>');
          email.setTos(record.sentTo);
          sendgrid.send(email, function(err, json) {
            if (err) { return console.error(err); }
            console.log(json);
          });
        });
        res.redirect('/telecomics/'+record._id);
      });
    });
  }
});

router.get('/telecomics/view/created', function (req, res, next) {
  comics.find({owner_id: req.session.uId}).then(function (data) {
    res.render('created', {comics: data})
  })
})

router.get('/telecomics/:id/edit', function(req, res, next) {
  comics.findOne({_id: req.params.id}).then(function (comic) {
    var data = {
      title: comic.title,
      pane1: comic.panes[0].imageSource,
      pane2: comic.panes[1].imageSource,
      pane3: comic.panes[2].imageSource,
      comment1: comic.panes[0].comment,
      comment2: comic.panes[1].comment,
      comment3: comic.panes[2].comment,
    };
    res.render('edit', {data: data, id:req.params.id});
  });
});

router.post('/telecomics/:id/delete', function (req, res, next) {
  comics.remove({_id:req.params.id});
  res.redirect('/');
});

router.get('/telecomics/:id/resend', function (req, res, next) {
  transcomics.findOne({_id: req.params.id}).then(function (transcomic) {
    comics.findOne({_id: transcomic.comicId}).then(function (comic) {
      var data = {
        title: comic.title,
        pane1: comic.panes[0].imageSource,
        pane2: comic.panes[1].imageSource,
        pane3: comic.panes[2].imageSource,
        comment1: transcomic.blurbs[0],
        comment2: transcomic.blurbs[1],
        comment3: transcomic.blurbs[2],
      };
      res.render('new', {data: data});
    })
  })
})

router.get('/telecomics/:id', function (req, res, next) {
  var comicMaster;
  transcomics.findOne({_id: req.params.id}).then(function (transcomic) {
    // console.log(transcomic);
    comicMaster = transcomic;
    return comics.findOne({_id: transcomic.comicId});
  }).then(function (comic) {
    // console.log(comic);
    comicMaster.panes = comic.panes;
    comicMaster.title = comic.title;
    res.render('show', {comic:comicMaster,
      panes: comicMaster.panes,
      blurbs: comicMaster.blurbs,
      panes: comicMaster.panes,
      languages:comicMaster.languages});
  });
});

router.post('/telecomics/imagesearch', function (req, res, next) {
  res.redirect('http://images.google.com/images?q='+req.body.search+'&btnG=Search+Images')
})

module.exports=router;
