# rtjscomp

easy to use http server that allows for using javascript just as php was used back in the days

> [!WARNING]  
> as the issues indicate, a lot of breaking changes are ahead.
> make sure to check for these in future until version 1.0.0 is relessed.

## Usage

go into the directory where you want to have your project and run

```console
$ npx rtjscomp
```

or in case you prefer [bun](https://bun.sh):

```console
$ bunx rtjscomp
```

and now http://localhost:8080 offers a greeting!

for developing rtjscomp itself, clone this repository and run

```console
$ npm install
$ npm start
```

## Files

when run first time, it will be created with some defaults. all files in config/public are watched, no reload command needed.

### Directories

- config dir, has simple txt files (this will change soon!)
- data dir, services store their data here
- public dir, containing dynamic and static offerings and also services

### File types

- static files like .png in public dir are sent to requests 1:1
- dynamic files like .html are transpiled to javascript and thereby compiled to machine code by the js engine as they are first time requested -> "rtjscomp"
- .service.js files are executed and their `this` can be accessed by other files, they are not accessible to outside

## API

in every served dynamic file (like .html), you can insert `<?` and `?>` tags to insert javascript code that is executed server-side. `<?= ... ?>` can be used to insert the result of an expression.
request-independent services can be created using .service.js files referenced in services.txt.
in both file types (dynamic served and services), you can use all node/bun methods including `require`, but also those:

- `service_require(service path)`: returns the matching service object
- `service_require_try(service path)`: returns the matching service object or null if not found or if disabled
- `rtjscomp`: has these properties/methods:
  - `actions`: an object with methods for server control (http[s]_[start|stop|restart|kill], log_clear, halt, exit)
  - `async data_load(path)`: reads the file in data directory and returns its content or null
  - `async data_load_watch(path, callback(content))`: executes callback first and on every change
  - `async data_save(path, content)`: writes the content to the file in data directory

## Supported environments

- node 4.0.0 or higher
- bun

any os
