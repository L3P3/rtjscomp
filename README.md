# rtjscomp

easy to use http server that allows for using javascript just as php was used back in the days

## Usage

```console
$ bun i
$ bun run rtjscomp.js
```

and now localhost:8080 offers a greeting!

## api

in every served dynamic file (like .html), you can insert `<?` and `?>` tags to insert javascript code that is executed server-side. `<?= ... ?>` can be used to insert the result of an expression.
request-independent services can be created using .service.js files referenced in services.txt.
in both file types (dynamic served and services), you can use all node/bun methods including `require`, but also those:

- `service_require(service path)`: returns the matching service object
- `service_require_try(service path)`: returns the matching service object or null if not found or if disabled
- `rtjscomp`: has these properties/methods:
  - `actions`: an object with methods for server control (http[s]_[start|stop|restart|kill], log_clear, shutdown, restart)
  - `async data_load(path)`: reads the file in data directory and returns its content or null
  - `async data_load_watch(path, callback(content))`: exeutes callback first and on every change
  - `async data_save(path, content)`: writes the content to the file in data directory

## Supported environments

- node 4.0.0 or higher
- bun (my default!)

any os
