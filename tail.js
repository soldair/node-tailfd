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
    noent = 0,
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
          } else if(noent) {
            z.tails[stat.ino].pos = 0;
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
        z.tails[stat.ino].linePos = z.tails[stat.ino].pos;
        z.tails[stat.ino].fd = data.fd;
      }

      z.tails[stat.ino].stat = stat;
      z.tails[stat.ino].changed = 1;
      z.readChangedFile(z.tails[stat.ino]);
    });

    watch.on('noent',function(){
      // if the file didnt exist when the watch started and its the first time start should be 0.
      noent = 1;
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
      
      tailInfo.buf = tailInfo.buf.toString()+buffer.toString();

      var lines = tailInfo.buf.split(options.delimiter||"\n");
      var b;

      tailInfo.buf = lines.pop();
      
      tailInfo.linePos = tailInfo.pos-tailInfo.buf.length;


      for(var i=0,j=lines.length;i<j;++i) {
        // binary length. =/ not efficient this way but i dont want to emit lines as buffers right now
        b = new Buffer(lines[i]+(options.delimiter||"\n"));

        if(!tailInfo.linePos) tailInfo.linePos = 0;

        if(tailInfo.linePos > tailInfo.pos) {
          console.log('i have a bug! tailinfo line position in source file is greater than the position in the source file!');
          console.log('linePos:',tailInfo.linePos-b.length,'pos:',tailInfo.pos);
          tailInfo.linePos = tailInfo.pos;
        }
        // copy tailinfo with line position so events can be handles async and preserve state
        z.emit('line',lines[i],_ext({},tailInfo));
      }

      // in order to make last line length reflect the binary length buf has to be packed into a Buffer.
      tailInfo.buf = new Buffer(tailInfo.buf);

      if(tailInfo.buf.length >= z.maxLineLength){
        z.emit('line-part',tailInfo.buf,tailInfo);
        tailInfo.linePos += tailInfo.buf.length;
        tailInfo.buf = '';
      }

      if(tailInfo.linePos < (tailInfo.pos-tailInfo.buf.length)) {
        console.log('i have a bug! tailinfo line position in source file is less than the ammount of data i should have sent!');
      }

    });

    //10k max per read
    this.maxBytesPerRead = options.maxBytesPerRead || 10240;
    // 1mb max per line
    this.maxLineLength = options.maxLineLength || 102400;
    // 3 read attempts per range
    this.readAttempts = options.readAttempts||3;
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

      if(ti.reading) {
        //still reading file
        continue;
      }

      if (!z.tails[ti.stat.ino]) {
        //remove timed out file tail from q
        z.q.splice(i,1);
        --i;
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
      //retry attempts per range.
      var attempts = [];

      var readJob = function(len){
        fs.read(tailInfo.fd, new Buffer(len), 0, len, tailInfo.pos, function(err,bytesRead,buffer) {
          if(err) {
            attempts.push(err);
            //
            // after configured number of attempts emit range-unreadable and move to next
            //
            if(attempts.length >= (z.readAttempts || 3)) {
              
              z.emit('range-unreadable',attempts,tailInfo.pos,len,tailInfo);
              // skip range
              tailInfo.pos += len;
              attempts = [];
            }
            done();
            return;  
          }

          tailInfo.pos += bytesRead;
          attempts = [];
          //
          // TODO
          // provide a stream event for each distinct file descriptor
          // i cant stream multiple file descriptor's data through the same steam object because mixing the data makes it not make sense.
          // this cannot emit data events here? because to be a stream the above case has to make sense.
          //
          z.emit('data',buffer,tailInfo);
          done();
        });
      },
      done = function(){
        //
        //if paused i should not continue to buffer data events.
        //

        if(!len || z.watch.paused){
          tailInfo.reading = 0;
          if(z.watch.paused && len){
            // if i am paused mid read requeue remaining.
            z.q.push(tailInfo);
            //console.log('requeued remaining read because im paused');
          }
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
  // return the total line buffer length from all active tails
  //
  lineBufferLength:function(){
    var z = this;
    var l = 0;
    Object.keys(z.tails).forEach(function(k) {
      l += (z.tails[k].buf||'').length;
    });
    return l;
  },
  //
  // streamy methods
  //
  pause:function() {
    this.watch.pause();
  },
  resume:function(){
    this.watch.resume();
    // i may have been stopped mid read so changes may still need to be read.
    this.readChangedFile();
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
    linePos:0,
    fd:data.fd,
    buf:''
  };

  return o;
}

function _ext(o,o2){
  for(var i in o2) if(o2.hasOwnProperty(i)) o[i] = o2[i];
  return o;
}
