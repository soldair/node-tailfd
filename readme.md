[![Build Status](https://secure.travis-ci.org/soldair/node-tailfd.png)](http://travis-ci.org/soldair/node-tailfd)

## goal

Tail a file. it should work great. This will continue to work even if a file is unlinked rotated or truncated. It is also ok if the path doesnt exist before watching it

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

## install

	npm install tailfd

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
	- fs.Stats cur, fs.Stats prev
- open
	- fs.Stats cur,{fd:file descriptor,stat:fs.Stats cur}
- unlink
	- fs.Stats cur,{fd:file descriptor,stat:fs.Stats cur}
- timeout
	- fs.Stats cur,{fd:file descriptor,stat:fs.Stats cur}

### tailInfo properties

- stat
	- instanceof fs.Stats
- pos
	- current seek position in the file
- fd
	- file descriptor being tailed
- buf
	- string containing the last data fragment from delimiter parsing


#### watch file and watch may behave differently on different systems here is the doc for it.

- http://nodejs.org/api/fs.html#fs_fs_writefile_filename_data_encoding_callback
- http://nodejs.org/api/fs.html#fs_fs_watch_filename_options_listener
