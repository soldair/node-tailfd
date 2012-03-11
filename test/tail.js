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
    t.fail('hard timeout of 10 seconds reached. something is wrong');
    t.end();
    watcher.close();
  },10000);

  watcher.on('data',function(buffer,tailInfo){
    buf += buffer.toString();
    prevdata = buffer.toString();

    t.ok(buffer.length,'buffer should have length');
    t.notEqual(prevpos,tailInfo.pos,'for another change should not have the same pos in tailed file as before');
    t.equal(prevpos+buffer.length,tailInfo.pos,'prev pos + buffer read should be new pos');

    prevpos = tailInfo.pos;

    if(writeDone){
      watcher.close();
      t.end();
      clearTimeout(timer);
    }
  });

  var ws = fs.createWriteStream(log,{flags:'w+'}),
  loop = 10,
  inter;

  ws.on('open',function(){
    inter = setInterval(function(){
      if(!(--loop)) {
        writeDone = 1;
        clearInterval(inter);
      }

      try{
        //_log('writing');
        ws.write(new Buffer(Date.now()+"\n"));
      } catch (e) {
        _log(e+' >> '+e.stack);
      }
    },10);
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


