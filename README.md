# rtjscomp

easy to use http server that allows for using javascript just as php was used back in the days

> [!NOTE]  
> this project has not reached v1.0.0 yet, so breaking changes _may appear_ in the future

## usage

go into the directory where you want to have your project and run

```console
$ npx --yes rtjscomp@latest
```

or in case you prefer [bun](https://bun.sh):

```console
$ bunx --bun rtjscomp@latest
```

and now http://localhost:8080 offers a greeting!

for developing rtjscomp itself, clone this repository and run

```console
$ npm start
```

## rtjscomp.json (optional)

it is only needed if you want to change default settings. it has the following properties:

- `compress`: boolean, set to false to disable any compression
- `gzip_level`: compression level, 0-9, default is 9
- `log_verbose`: boolean, set true for more verbose logging or run with -v
- `path_aliases`: object where the key is the url path and the value is the file path
- `path_ghosts`: array of paths that are simply ignored, no response is sent
- `path_hiddens`: array of paths that give 404
- `path_statics`: array of paths in which nothing is transpiled, but the file is sent as is
- `port_http`: port for http server, default is 8080
- `port_https`: port for https server
- `services`: paths to (enabled) service files, prepend an entry with # to disable it
- `type_dynamics`: dynamic file types, see [api](#api)
- `type_mimes`: file type to mime type map (most common are already set, only overrides)
- `type_raws`: array of file types that are sent uncompressed
- `zstd_level`: compression level for zstd, 0-19, default is 3

here is an example for a customized setup:

```json
{
  "path_aliases": {
    "": "index.html",
    "blog": "modules/blog/index.html",
    "blog/*id": "modules/blog/article.html"
  },
  "path_ghosts": [ "admin", "wp-admin" ],
  "path_hiddens": [ "secrets.html" ],
  "path_statics": [ "rawtruth.html" ],
  "port_http": 8080,
  "services": [
    "modules/blog/blog",
    "#modules/not/needed"
  ],
  "type_dynamics": [ "html", "js" ],
  "type_mimes": {
    "html": "text/html; charset=UTF-8",
    "js": "application/javascript; charset=UTF-8",
    "custom": "application/custom"
  },
  "type_raws": [ "png", "jpg", "pdf" ]
}
```

## directories

on first run, they will be created with some defaults.

- data dir, services store their data or read custom config files here
- public dir, containing dynamic and static offerings and also services

## files in public dir

- static files like .png in public dir are sent to requests 1:1, maybe compressed
- dynamic files like .html are internally transpiled/compiled and executed -> "rtjscomp"
- .service.js files are executed and their `this` can be accessed by other files, they are not accessible to outside

example:

```
public
├── index.html
├── modules
│   ├── blog
│   │   ├── article.html
│   │   ├── blog.service.js
│   │   └── index.html
│   └── not
│       └── needed.service.js
├── rawtruth.html
└── secrets.html
```

## api

in every served dynamic file (like .html), you can insert `<?` and `?>` tags to insert javascript code that is executed server-side. `<?= ... ?>` can be used to insert the result of an expression.
request-independent services can be created using .service.js files referenced in services.txt.
in both file types (dynamic served and services), you can use all node/bun methods including `require`, but also those:

- `log(msg)`: logs the message to the console
- `service_require(service path)`: returns the matching service object
- `service_require_try(service path)`: returns the matching service object or null if not found or if disabled
- `rtjscomp`: has these properties/methods:
  - `actions`: an object with methods for server control (http[s]_[start|stop|kill], log_clear, halt, exit)
  - `async data_load(path)`: reads the file in data directory and returns its content or null
  - `async data_load_watch(path, callback(content))`: executes callback first and on every change
  - `async data_save(path, content)`: writes the content to the file in data directory

## supported environments

- node 8.0.0 or higher
- bun

any os
