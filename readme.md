[![Build Status](https://secure.travis-ci.org/soldair/node-tailfd.png)](http://travis-ci.org/soldair/node-tailfd)

## goal

provide events for any file descriptors that are referenced by a watched path
or were referenced by a watched path for as long as they are active.
active is defined by a timeout since last event. file descriptors that become inactive are removed.


## install

	npm install tailfd

## use
	```js
	var tail = require('tailfd').tail,
	watcher = tail('/some.log',function(line,tailInfo){
		//default line listener. optional.
		console.log('line of data> ',line);
	});

	//if you want your process to exit. or use options.persistent = false
	watcher.close();
	```

### use case

Tail a file. it should work great. This will continue to work even if a file is unlinked rotated or truncated.
It is also ok if the path doesnt exist before watching it.

### argument structure

tailfd.tail(filename, [options], listener)

- filename
  this should be a regular file or non existent. the behavior is undefined in the case of a directory.

- options. supported custom options are

	```js
	{

	"start":undefined, //defaults to the first reported stat.size
	//optional. a hard start position in the file for tail to start emitting data events.

	"offset":0,
	//optional.  offset is negtively applied to the start position

	"delimiter":"\n"
	//optional. defaults to newline but can be anything

	}

	// the options object is passed to watchfd as well. With watchfd you may configure

	{

	"timeout": 60*60*1000, //defaults to one hour
	//how long an inactive file descriptor can remain inactive before being cleared

	"timeoutInterval":60*5*1000 //every five minutes
	// how often to check for inactive file descriptors

	}

	//the options object is also passed directly to fs.watch and fs.watchFile so you may configure

	{
	"persistent":true, //defaults to true
	//persistent indicates whether the process should continue to run as long as files are being watched

	"interval":0, //defaults 0
	//interval indicates how often the target should be polled, in milliseconds. (On Linux systems with inotify, interval is ignored.) 
	}
	```

- callback
  this is bound to the line event of the watcher. its optional.

	```js
	callback(line,tailInfo)
	```

  cur and prev are instances of fs.Stats

### events

- line
	String line, Object tailInfo
- data
	Buffer buffer, Object tailInfo

#### events inherited from watchfd

- change
		fs.Stats cur, fs.Stats prev
- open
		fs.Stats cur,{fd:file descriptor,stat:fs.Stats cur}
- unlink
                fs.Stats cur,{fd:file descriptor,stat:fs.Stats cur}
- timeout
                fs.Stats cur,{fd:file descriptor,stat:fs.Stats cur}

### tailInfo Object

#### windows support problems

- It uses file inode as a unique id for each descriptor. I know there is a way to get a unique id for a file in windows i just don't know if that would be passed to stat as stat.ino. 
- I use watchFile which is not supported at all on windows but this would be easier to overcome considering i can use a configured polling interval as a stat polling fall back on windows. 
- I also don't know windows very well and don't know if windows has the problem this module solves...but i imagine it would

#### notes

I noticed distinct differences in watchFile vs watch api
fs.watchFile will issue events for a file that is currently referenced by a path
fs.watch will take a path but issue events whenever that file descriptor is changed even after it's unlinked

We should probably design servers to listen to SIGHUP and grab new file descriptors for all loggers but even if you used logrotate with copytruncate mode as to not change the file referenced by a path the chance that you will loose data is still there. I feel safer waiting for a file descriptor to be quiet so i know its out of use before i close it in a process that has the ability to read data out of it.


#### watch file and watch may behave differently on different systems here is the doc for it.

http://nodejs.org/api/fs.html#fs_fs_writefile_filename_data_encoding_callback
http://nodejs.org/api/fs.html#fs_fs_watch_filename_options_listener
