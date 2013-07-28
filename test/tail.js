var test = require('tap').test,
fs = require('fs'),
tail = require('../tail.js').tail;

function _log(msg){
  process.stderr.write(new Buffer(JSON.stringify(msg)+"\n"));
}

var cleanup = [];

test('should be able to tail something',function(t){
  var log = './'+Date.now()+'.log';
  cleanup.push(log);

  var watcher = tail(log,{start:0});

  t.ok(typeof watcher == 'object','watcher should be some kind of object');
  t.ok(watcher.on,'watcher should have an on method');

  var testedChange = 0;
  watcher.on('change',function(){
    if(!testedChange) {
      t.ok(++testedChange,'change event should have been fired');
    }
  });

  var writeDone,
  buf = '',
  prevpos = 0,
  prevdata = '',
  timer = setTimeout(function(){
    t.fail('hard timeout of 20 seconds reached. something is wrong');
    t.end();
    watcher.close();
  },20000),
  len = -1,
  checkBuf = function(){
    if(len == buf.length) {
      watcher.close();
      clearTimeout(timer);
      t.equals(len,buf.length,'buffer should be expected length');
      t.end();
    }
  };

  watcher.on('data',function(buffer,tailInfo){
    buf += buffer.toString();
    prevdata = buffer.toString();

    t.ok(buffer.length,'buffer should have length');
    t.notEqual(prevpos,tailInfo.pos,'for another change should not have the same pos in tailed file as before');
    t.equal(prevpos+buffer.length,tailInfo.pos,'prev pos + buffer read should be new pos');

    prevpos = tailInfo.pos;

    if(writeDone){
      checkBuf();
    }
  });

  writeLog(log,function(err,l){
    len = l;
    writeDone = 1;
    checkBuf();
  });

});


test("should be able to write half lines",function(t){
  var log = './'+Date.now()+'-'+Math.random()+'.log';
  cleanup.push(log);

  var watcher = tail(log),
  buf = '',
  c = 0,
  len = 4,
  checkBuf = function(){
    watcher.close();
    t.equals(len,buf.length,'buffer should be expected length when writing incomplete lines.');
    t.equals(buf,'HIHO',' should have written HIHO');
    t.end();
  }
  ;
  watcher.on('line',function(data){
    buf += data.toString();
    checkBuf();
  });

  watcher.on('data',function(){
    if(!c) { 
      ws.write('HO\n');
      ws.end();
    }
    c++;
  });

  var ws = fs.createWriteStream(log);
  ws.write('HI');

});

test('should be able to pause/resume tail',function(t){
  var log = './'+Date.now()+'-'+Math.random()+'.log';
  cleanup.push(log);

  var watcher = tail(log,{start:0}),
  buf = '',
  timer = setTimeout(function(){
    t.fail('hard timeout of 20 seconds reached. something is wrong');
    t.end();
    watcher.close();
  },20000),
  c = 0,
  len = -1,
  checkBuf = function(){
    if(len == buf.length) {
      clearTimeout(timer);
      watcher.close();
      t.equals(len,buf.length,'buffer should be expected length');
      t.end();
    }
  }
  ;

  watcher.pause();
  setTimeout(function(){
    t.equals(c,0,'should not have emitted any data events while paused');
    watcher.resume(); 

  },500);

  watcher.on('data',function(data){
    c++;
    buf += data.toString();
    checkBuf();
  });

  writeLog(log,function(err,l){
    writeDone = 1;
    len = l;
    process.nextTick(function(){
      checkBuf();
    });
  });

  watcher.on('range-unreadable',function(){
    console.log(arguments);

    clearTimeout(timer);
    t.fail('should not get range unreadable error');
    t.end();
    watcher.close();
  });
});


process.on('exit',function(){
    var fs = require('fs');
    while(cleanup.length) {
      try {
        fs.unlinkSync(cleanup.pop());
  
      } catch (e){
        console.log('cleanup error');
        console.error(e);
      }
    }
});

function writeLog(log,cb){
  var ws = fs.createWriteStream(log,{flags:'w+'}),
  loop = 10,
  len = 0,
  inter;

  ws.on('open',function(){
    inter = setInterval(function(){
      if(!(--loop)) {
        clearInterval(inter);
        cb(null,len);
        return;
      }

      try{
        //_log('writing');
        var b = new Buffer(Date.now()+"\n");
        len += b.length;
        ws.write(b);
      } catch (e) {
        _log(e+' >> '+e.stack);
      }
    },10);
  });

  return inter;
}
