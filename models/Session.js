var mongoose = require('mongoose')

var Message = require('./Message')

var validTypes = ['Math', 'College']

// helper to perform MongoDB query on a field of a document only if necessary
// i.e. if v is set to the document ID instead of the document, and call back
// with the result of a validator on the property
function queryIfNecessary(v, property, msg, cb, validator) {
  if (typeof(v[property]) === "undefined") {
    // query the database
    // doing this with raw MongoDB query so we don't couple tightly to User.js
    mongoose.connection.db.collection('users').findOne({"_id": v})
      .then(function(result) {
        cb(validator(result[property]), msg)
      })
      .catch(function(error) {
        cb(false, error)
      })
  } else {
    cb(validator(v[property]), msg)
  }
}

var sessionSchema = new mongoose.Schema({
  student: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    validate: {
      isAsync: true,
      validator: function(v, cb) {
        var msg = `User ${v} is a volunteer`
        
        queryIfNecessary(v, 'isVolunteer', msg, cb, function(value) {
          return !value
        })
      }
    },
    required: [true, 'A session requires a student user ID']
  },
  volunteer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    validate: {
      isAsync: true,
      validator: function(v, cb) {
        var msg = `User ${v} is a student`
        
        queryIfNecessary(v, 'isVolunteer', msg, cb, function(value) {
          return value
        })
      }
    }
  },
  type: {
    type: String,
    validate: {
      validator: function (v) {
        var type = v.toLowerCase()
        return validTypes.some(function (validType) {
          return validType.toLowerCase() === type
        })
      },
      message: '{VALUE} is not a valid type'
    },
    required: [true, 'A session needs a type']
  },

  subTopic: {
    type: String,
    default: ''
  },

  messages: [Message.schema],

  whiteboardUrl: {
    type: String,
    default: ''
  },

  createdAt: {
    type: Date,
    default: Date.now
  },

  endedAt: {
    type: Date
  },

  volunteerJoinedAt: {
    type: Date
  }

  // Scheduled sessions
  // startAt: {
  //   type: Date,
  //   default: Date.now
  // }
})

sessionSchema.methods.saveMessage = function (messageObj, cb) {
  var session = this
  this.messages = this.messages.concat({
    user: messageObj.user._id,
    contents: messageObj.contents
  })

  var messageId = this.messages[this.messages.length - 1]._id
  this.save(function (err) {
    var savedMessageIndex = session.messages.findIndex(function (message) {
      return message._id === messageId
    })

    var savedMessage = session.messages[savedMessageIndex]
    cb(null, savedMessage)
  })
}

sessionSchema.methods.saveWhiteboardUrl = function (whiteboardUrl, cb) {
  var session = this
  this.whiteboardUrl = whiteboardUrl
  this.save(function (err) {
    if (cb) {
      cb(null, session.whiteboardUrl)
    }
  })
}

//
sessionSchema.methods.joinUser = function (user, cb) {
  if (user.isVolunteer) {
    this.volunteer = user
    this.volunteerJoinedAt = new Date()
  } else {
    this.student = user
  }
  this.save(cb)
}
sessionSchema.methods.leaveUser = function (user, cb) {
  // below should not save volunteer/user to null, we need to be able to see who the volunteer and student user were
  // should set this.endedAt to Date.now and end the session, both users see the session ended regardless of who ended it
  // student can receive a message telling them they can request help again
  if (user.isVolunteer) {
    this.volunteer = user
  } else {
    this.student = user
  }
}

sessionSchema.methods.endSession = function (cb) {
  this.endedAt = new Date()
  this.save(() => console.log(`Ended session ${this._id} at ${this.endedAt}`))
}

sessionSchema.methods.isActive = function (cb) {}

sessionSchema.methods.isWaiting = function (cb) {}

module.exports = mongoose.model('Session', sessionSchema)
