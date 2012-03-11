var watchfd = require('watchfd'),
fs = require('fs');


exports.tail = function(log,options,cb){
  var tails = {},
  q = [],
  watch,
  args = Array.prototype.slice.call(arguments);


  //this emits the data events on the watcher emitter for all fds
  function readChangedFile(tailInfo){

    if(tailInfo) {
      q.push(tailInfo);
    }

    //avoiding the jshint "dont create functions in a loop"
    // executed in the context of a tailInfo object
    function readTail(len) {
      var self = this;

      if(len){
        self.reading = 1;
        fs.read(self.fd, new Buffer(len), 0, len, self.pos, function(err,bytesRead,buffer) {
          self.reading = 0;
          self.pos += bytesRead;

          watch.emit('data',buffer,self);
          //handle any queued change events
        });
      }
    }

    var ti; 
    //for all changed fds fire readStream
    for(var i = 0;i < q.length;++i) {
      ti = q[i];
      if (!tails[ti.stat.ino]) {
        //remove timed out file tail from q
        q.splice(i,1);
        --i;
        continue;
      }

      if(ti.reading) {
        //still reading file
        continue;
      }

      //truncated
      if(ti.stat.size < ti.pos) {
        ti.pos = 0;
      }

      var len = ti.stat.size-ti.pos;
      //remove from queue because im doing this work.
      q.splice(i,1);
      --i;

      readTail.call(ti,len);
    }
  }

  // load args from args array
  log = args.shift();
  options = args.shift() || {};
  cb = args.pop();

  //support optional callback
  if(typeof options == 'function') {
    if(!cb) cb = options;
    options = {};
  }
  var first = 1;
  //start watching
  watch = watchfd.watch(log,options,function(stat,prev,data){
    if(cb) cb.apply(this,arguments);
    if(!tails[stat.ino]) {
      tails[stat.ino] = tailDescriptor(data);
      tails[stat.ino].pos = stat.size;
      // if this is the first time i have picked up any file attached to this fd
      if (first) {
        first = 0;
        //apply hard start
        if(typeof options.start != 'undefined') {
          tails[stat.ino].pos = options.start>stat.size?stat.size:options.start;
        }

        //apply offset
        if(options.offset) {
          tails[stat.ino].pos -= options.offset;
        }

        //dont let offset take read to invalid range
        if(tails[stat.ino].pos > stat.size) {
          tails[stat.ino].pos = stat.size;
        } else if (tails[stat.ino].pos < 0) {
          tails[stat.ino].pos = 0;
        }
      } else {
        //new file descriptor at this file path but not the first one.
        //an unlink+create or rename opperation happened.
        //should i start from 0 if some file with data in it was moved to my watched path?
        tails[stat.ino].pos = 0;
      }

      tails[stat.ino].fd = data.fd;
    }

    tails[stat.ino].stat = stat;
    tails[stat.ino].changed = 1;
    readChangedFile(tails[stat.ino]);
  });

  watch.on('unlink',function(stat,prev,data){
    if(tails[stat.ino]) {
      tails[stat.ino].stat = stat;
      tails[stat.ino].changed = 1;
    }
  });

  watch.on('timeout',function(stat,data){
    if(tails[stat.ino]) {
      delete tails[stat.ino];
      //cleanup queue will be in queue process.
    }
  });

  return watch;
};

function tailDescriptor(data){
  var o = {
    pos:0,
    fd:data.fd,
    firstline:1
  };

  return o;
}



