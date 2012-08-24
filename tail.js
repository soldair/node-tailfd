var watchfd = require('watchfd'),
EventEmitter = require('events').EventEmitter,
util = require('util'),
fs = require('fs');


module.exports = function(log,options,cb){
  var tails = {},
  q = [],
  watch,
  args = Array.prototype.slice.call(arguments);

  // load args from args array
  log = args.shift();
  options = args.shift() || {};
  cb = args.pop();

  //support optional callback
  if(typeof options == 'function') {
    if(!cb) cb = options;
    options = {};
  }

  //start watching
  var tailer = new TailFd(log,options);

  if(cb) {
    tailer.on('line',function(line,tailInfo){
      cb(line,tailInfo);    
    });
  }

  return tailer;
};

module.exports.tail = module.exports;

function TailFd(log,options){
  this.startWatching(log,options);
}

util.inherits(TailFd,EventEmitter);

_ext(TailFd.prototype,{
  q:[],
  tails:{},
  watch:null,
  startWatching:function(log,options){
    var z = this,
    first = 1,
    watch = this.watch = watchfd.watch(log,options,function(stat,prev,data){
      //
      // TODO
      // test refactor from stat.ino to +data.fd 
      //
      if(!z.tails[stat.ino]) {
        z.tails[stat.ino] = tailDescriptor(data);
        z.tails[stat.ino].pos = stat.size;
        // if this is the first time i have picked up any file attached to this fd
        if (first) {
          first = 0;
          //apply hard start
          if(typeof options.start != 'undefined') {
            z.tails[stat.ino].pos = options.start>stat.size?stat.size:options.start;
          }

          //apply offset
          if(options.offset) {
            z.tails[stat.ino].pos -= options.offset;
          }

          //dont let offset take read to invalid range
          if(z.tails[stat.ino].pos > stat.size) {
            z.tails[stat.ino].pos = stat.size;
          } else if (z.tails[stat.ino].pos < 0) {
            z.tails[stat.ino].pos = 0;
          }
        } else {
          //new file descriptor at this file path but not the first one.
          //an unlink+create or rename opperation happened.
          //
          // TODO
          // if A file was moved to this path i should still start from 0.
          // i better have flood control for this case because fs.read will seriously read all of that data from the file
          //
          z.tails[stat.ino].pos = 0;
        }

        z.tails[stat.ino].fd = data.fd;
      }

      z.tails[stat.ino].stat = stat;
      z.tails[stat.ino].changed = 1;
      z.readChangedFile(z.tails[stat.ino]);
    });

    watch.on('unlink',function(stat,prev,data){
      if(z.tails[stat.ino]) {
        z.tails[stat.ino].stat = stat;
        z.tails[stat.ino].changed = 1;
      }
      z.emit.apply(z,arguments);
    });

    watch.on('timeout',function(stat,data){
      if(z.tails[stat.ino]) {
        delete z.tails[stat.ino];
        //cleanup queue will be in queue process.
      }
      z.emit.apply(z,arguments);
    });
    
    this.on('data',function(buffer,tailInfo){

      tailInfo.buf += buffer.toString();
      var lines = tailInfo.buf.split(options.delimiter||"\n");
      tailInfo.buf = lines.pop();

      for(var i=0,j=lines.length;i<j;++i) {
        z.emit('line',lines[i],tailInfo);
      }
    });

    this.maxBytesPerRead = options.maxBytesPerRead || 10240;
  },
  //this emits the data events on the watcher emitter for all fds
  readChangedFile:function(tailInfo){
    var z = this;

    if(tailInfo) {
      z.q.push(tailInfo);
    }

    var ti; 
    //for all changed fds fire readStream
    for(var i = 0;i < z.q.length;++i) {
      ti = z.q[i];
      if (!z.tails[ti.stat.ino]) {
        //remove timed out file tail from q
        z.q.splice(i,1);
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
      z.q.splice(i,1);
      --i;

      z.readTail(ti,len);
    }
  },
  readTail:function(tailInfo,len) {
    var z = this;
    if(len){
      tailInfo.reading = 1;
      
      var readJob = function(len){
        //console.log('read job for ',len,' bytes from ',tailInfo.pos);
        //binding.read(fd, buffer, offset, length, position, wrapper);
        fs.read(tailInfo.fd, new Buffer(len), 0, len, tailInfo.pos, function(err,bytesRead,buffer) {
          tailInfo.pos += bytesRead;
          //console.log('calledback!',bytesRead);
          //
          // TODO
          // provide a stream event for each distinct file descriptor
          // i cant stream multiple file descriptor's data through the same steam object because mixing the data makes it not make sense.
          //
          // this cannot emit data events here because to be a stream the above case has to make sense.
          //
          z.emit('data',buffer,tailInfo);
          done();
        });
      },
      done = function(){
        if(!len) {
          tailInfo.reading = 0;
          //console.log('done reading');
          return;
        }

        var toRead = z.maxBytesPerRead;
        if(len < toRead) {
          toRead = len;
        }
        len -= toRead;
        
        readJob(toRead);
      }
      ;
      done();

    }
  },
  //
  // streamy methods
  //
  pause:function() {
    this.watch.pause();
  },
  resume:function(){
    this.watch.resume();
  },
  destroy:function(){
    this.close();
  },
  destroySoon:function(){
    this.close();
  },
  close:function(){
    this.readable = false;
    this.emit('close');
    this.watch.close();
  },
  writable:false,
  readable:true
});

function tailDescriptor(data){
  var o = {
    stat:null,
    pos:0,
    fd:data.fd,
    buf:''
  };

  return o;
}

function _ext(o,o2){
  for(var i in o2) if(o2.hasOwnProperty(i)) o[i] = o2[i];
  return o;
}
