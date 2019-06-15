var Session = require('../models/Session')
var twilioService = require('../services/twilio')
var ObjectId = require('mongodb').ObjectId

// A socket session tracks a session with its users and sockets
var SocketSession = function (options) {
  this.session = options.session
  this.users = [] // [User]
  this.sockets = {} // userId => socket
}

// Add a socket and user to the session. If the user already has a socket,
// disconnect and replace it
SocketSession.prototype.join = function (options) {
  var user = options.user
  var socket = options.socket
  var userIndex = this.users.findIndex(function (joinedUser) {
    return joinedUser._id === user._id
  })

  if (userIndex !== -1) {
    socket = this.sockets[user._id]
    if (socket) {
      socket.disconnect(0)
    }
    this.users.splice(userIndex, 1)
  }

  this.users.push(user)
  this.sockets[user._id] = socket
}

SocketSession.prototype.leave = function (socket) {
  var userIdEntry = Object.entries(this.sockets).find(function (e) {
    return e[1] === socket
  })
  var userId = userIdEntry ? userIdEntry[0] : null

  console.log('User', userId, 'leaving from', this.session._id)

  var userIndex = this.users.findIndex(function (joinedUser) {
    return joinedUser._id === userId
  })

  if (userIndex !== -1) {
    this.users.splice(userIndex, 1)
  }

  delete this.sockets[userId]
}

SocketSession.prototype.hasSocket = function (socket) {
  return Object.keys(this.sockets).some(function (userId) {
    return this.sockets[userId] === socket
  }, this)
}

SocketSession.prototype.isDead = function () {
  return this.users.length === 0
}

var SessionManager = function () {
  this._sessions = {} // id => SocketSession
}

SessionManager.prototype.getSocketSessionBySocket = function (socket) {
  var socketSessionEntry = Object.entries(this._sessions).find(function(e) {
    return e[1].hasSocket(socket)
  })
  return socketSessionEntry ? socketSessionEntry[1] : null
}

SessionManager.prototype.connect = function (options) {
  const session = options.session
  const user = options.user
  const socket = options.socket
  let socketSession = this._sessions[session._id]

  if (!socketSession) {
    socketSession = new SocketSession({
      session: session
    })
    this._sessions[session._id] = socketSession
  } else {
    socketSession.session = session
  }

  socketSession.join({
    user: user,
    socket: socket
  })
}

SessionManager.prototype.disconnect = function (options) {
  var socket = options.socket

  var socketSession = this.getSocketSessionBySocket(socket)

  var session

  if (socketSession) {
    session = socketSession.session
    socketSession.leave(socket)
  } else {
    console.log('!!! no socketSession found on disconnect')
  }

  return session
}

// Delete any SocketSessions that are dead.
// A dead session is a session with no users connected to it.
//
// Return a reference to the SocketSession instance.
SessionManager.prototype.pruneDeadSessions = () => {
  if (!this._sessions) {
    return this
  }

  const sessionIds = Object.keys(this._sessions)
  const deadSessionIds = sessionIds.filter(sessionId =>
    this._sessions[sessionId].isDead()
  )

  deadSessionIds.forEach(sessionId => delete this._sessions[sessionId])

  return this
}

SessionManager.prototype.list = function () {
  var sessions = this._sessions
  return Object.keys(sessions).map(function (id) {
    return sessions[id].session
  })
}

SessionManager.prototype.getById = function (sessionId) {
  return this._sessions[sessionId]
}

SessionManager.prototype.getUserBySocket = function (socket) {
  var socketSession = this.getSocketSessionBySocket(socket)
  if (!socketSession) {
    return false
  }

  var userId = Object.keys(socketSession.sockets).find(function (joinedUserId) {
    return socketSession.sockets[joinedUserId] === socket
  })

  return socketSession.users.find(function (joinedUser) {
    return joinedUser._id === userId
  })
}

var sessionManager = new SessionManager()

module.exports = {
  create: function (options, cb) {
    var user = options.user || {}
    var userId = user._id
    var type = options.type
    var subTopic = options.subTopic

    if (!userId) {
      cb('Cannot create a session without a user id', null)
    } else if (user.isVolunteer) {
      cb('Volunteers cannot create new sessions', null)
    } else if (!type) {
      cb('Must provide a type for a new session', null)
    }

    var session = new Session({
      student: userId,
      type: type,
      subTopic: subTopic
    })

    if (!user.isTestUser) {
      twilioService.notify(type, subTopic)
    }

    session.save(cb)
  },

  get: function (options, cb) {
    var sessionId = options.sessionId

    var activeSession = sessionManager.getById(sessionId)
    if (activeSession) {
      cb(null, activeSession.session)
    } else {
      Session.findOne({ _id: sessionId }, cb)
    }
  },
  
  current: function(options, cb) {
    const userId = options.userId
    const isVolunteer = options.isVolunteer
  
    let studentId = null
    let volunteerId = null
  
    if (isVolunteer) {
      volunteerId = ObjectId(userId)
    } else {
      studentId = ObjectId(userId)
    }
  
    Session.findLatest(
      {
        $and: [
          { endedAt: null },
          {
            $or: [{ student: studentId }, { volunteer: volunteerId }]
          }
        ]
      }, cb)
  },

  // Return all current socket sessions as array
  getSocketSessions: function () {
    return sessionManager.list()
  },

  // Given a sessionId, create a socket session and join the session
  joinSession: function (options, cb) {
    var sessionId = options.sessionId
    var user = options.user
    var socket = options.socket

    Session.findOne({ _id: sessionId }, function (err, session) {
      if (err) {
        return cb(err)
      } else if (!session) {
        return cb('No session found!')
      }

      session.joinUser(user, function (err, savedSession) {
        if (err) {
          console.log(err)
          if (!savedSession) {
            cb(err) // so that api/sockets knows there's an issue
            return
          }
          sessionManager.disconnect({
            socket: socket
          })
          cb(err)
        }
        else {
          Session.populate(savedSession, 'student volunteer', function (
            err,
            populatedSession
          ) {
            sessionManager.connect({
              session: session,
              user: user,
              socket: socket
            })
            cb(err, populatedSession)
          })
        }
      })
    })
  },

  leaveSession: function (options, cb) {
    var socket = options.socket
    var user = sessionManager.getUserBySocket(socket)
    var session = sessionManager.disconnect({
      socket: socket
    })

    sessionManager.pruneDeadSessions()

    if (user) {
      session.leaveUser(user, cb)
    } else {
      cb(null, session)
    }
  }
}
