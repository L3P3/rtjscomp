#!/usr/bin/env node
/**
	@preserve RTJSCOMP by L3P3, 2017-2025
*/

"use strict";

(async () => {

// node libs
const fs = require('fs');
const fsp = require('fs/promises');
const http = require('http');
const url = require('url');
const zlib = require('zlib');

// external libs
const multipart_parse = require('parse-multipart-data').parse;
const querystring_parse = require('querystring').decode;
const request_ip_get = require('ipware')().get_ip;

// constants
const COMPRESS_METHOD_NONE = 0;
const COMPRESS_METHOD_GZIP = 1;
const COMPRESS_METHOD_BROTLI = 2;
const COMPRESS_METHOD_ZSTD = 3;
const GZIP_OPTIONS = {level: 9};
const HAS_BROTLI = zlib.createBrotliCompress != null;
const HAS_ZSTD = zlib.createZstdCompress != null;
const HTTP_LIST_REG = /,\s*/;
const IMPORT_REG = /\bimport\(/g;
const IS_BUN = typeof Bun !== 'undefined';
const LINENUMBER_REG = /:([0-9]+)[\):]/;
const PATH_CONFIG = 'config/';
const PATH_DATA = 'data/';
const PATH_PUBLIC = 'public/';
const RESOLVE_OPTIONS = {paths: [require('path').resolve()]};
const SERVICE_REQUIRE_REG = /\bservice_require\(([^)]*)\)/g;
const SERVICE_STATUS_PENDING = 0; // just added to list
const SERVICE_STATUS_WAITING = 1; // waiting for deps
const SERVICE_STATUS_STARTING = 2; // running startup
const SERVICE_STATUS_ACTIVE = 3; // ready for use
const SERVICE_STATUS_STOPPING = 4; // running stop fn
const SERVICE_STATUS_FAILED = 5; // waiting for fix
const VERSION = require('./package.json').version;
const WATCH_OPTIONS = {persistent: true, interval: 1000};
const ZSTD_c_compressionLevel = 100;
const ZSTD_OPTIONS = {
	params: {
		[ZSTD_c_compressionLevel]: 3,
	}
}

// config
const log_verbose_flag = process.argv.includes('-v');
let log_verbose = log_verbose_flag;
let port_http = 0;
let port_https = 0;
let compression_enabled = true;
let exiting = false;
/// any path -> file
const path_aliases = new Map([
	['', 'index.html'],
]);
const path_aliases_reverse = new Map([
	['index.html', '/'],
]);
const path_aliases_templates = new Map;
/// files where requests should be totally ignored
const path_ghosts = new Set;
/// hidden files
const path_hiddens = new Set;
/// forced static files
const path_statics = new Set;
const type_dynamics = new Set([
	'events',
	'html',
	'json',
	'txt',
]);
const type_mimes = new Map([
	['apk', 'application/zip'],
	['bpg', 'image/bpg'],
	['css', 'text/css; charset=utf-8'],
	['events', 'text/event-stream'],
	['flac', 'audio/flac'],
	['gz', 'application/gzip'],
	['hta', 'application/hta'],
	['html', 'text/html; charset=utf-8'],
	['ico', 'image/x-icon'],
	['jpg', 'image/jpeg'],
	['js', 'text/javascript; charset=utf-8'],
	['json', 'application/json; charset=utf-8'],
	['mid', 'audio/midi'],
	['mp3', 'audio/mpeg3'],
	['pdf', 'application/pdf'],
	['png', 'image/png'],
	['rss', 'application/rss+xml; charset=utf-8'],
	['txt', 'text/plain; charset=utf-8'],
	['xml', 'application/xml; charset=utf-8'],
	['xz', 'application/x-xz'],
	['zip', 'application/zip'],
]);
const type_raws = new Set([
	'apk',
	'bpg',
	'flac',
	'gz',
	'jpg',
	'mp3',
	'pdf',
	'png',
	'xz',
	'zip',
]);

/// compiled file handlers
const file_cache_functions = new Map;

const actions = {};
const rtjscomp = global.rtjscomp = {
	actions,
	version: VERSION,
};

// polyfills
if (!Object.fromEntries) {
	Object.fromEntries = entries => {
		const object = {};
		for (const entry of entries) object[entry[0]] = entry[1];
		return object;
	}
}

// workaround for bun: https://github.com/oven-sh/bun/issues/18919
let fs_watch = fs.watch;
if (IS_BUN) {
	const fs_watch_original = fs_watch;
	const watch_callbacks = new Map;
	fs_watch = (path, options, callback) => {
		if (!watch_callbacks.has(path)) {
			fs_watch_original(path, options, () => {
				const callback = watch_callbacks.get(path);
				if (callback) {
					callback();
				}
			});
		}
		watch_callbacks.set(path, callback);
		return {
			close: () => (
				watch_callbacks.set(path, null)
			),
		};
	}
}

// legacy, will be removed soon!
global.globals = rtjscomp;
global.actions = rtjscomp.actions;
global.data_load = name => {
	log('[deprecated] synchronous load file: ' + PATH_DATA + name);
	try {
		return fs.readFileSync(PATH_DATA + name, 'utf8');
	}
	catch (err) {
		return null;
	}
}
global.data_save = (name, data) => (
	log('[deprecated] synchronous save file: ' + PATH_DATA + name),
	fs.writeFileSync(PATH_DATA + name, data, 'utf8')
)
global.number_check_int = number => (
	Math.floor(number) === number
)
global.number_check_uint = number => (
	number >= 0 && number_check_int(number)
)

rtjscomp.data_load = async name => {
	if (log_verbose) log('load file: ' + PATH_DATA + name);
	const data = await fsp.readFile(PATH_DATA + name, 'utf8').catch(() => null);
	return (
		name.endsWith('.json')
		?	JSON.parse(data || null)
		:	data
	);
}
rtjscomp.data_load_watch = (name, callback) => (
	file_keep_new(PATH_DATA + name, data => (
		callback(
			name.endsWith('.json')
			?	JSON.parse(data || null)
			:	data
		)
	))
)
rtjscomp.data_save = (name, data) => (
	log_verbose && log('save file: ' + PATH_DATA + name),
	fsp.writeFile(
		PATH_DATA + name,
		(
			name.endsWith('.json')
			?	JSON.stringify(data)
			:	data
		),
		'utf8'
	)
)

/**
	hack to guess the line number of an error
*/
const linenumber_try = err => {
	try {
		return `:${
			err.stack
				.split('\n', 2)[1]
				.split(',').pop()
				.match(LINENUMBER_REG)[1]
			- 2
		}`;
	}
	catch (_) {
		return '';
	}
};

const custom_require_paths = new Set;
const custom_require_cache = new Map;
const custom_import_cache = new Map;
const custom_require = path => {
	let result = custom_require_cache.get(path);
	if (result != null) return result;

	log_verbose && log('require module: ' + path);
	const path_real = require.resolve(path, RESOLVE_OPTIONS);
	custom_require_paths.add(path_real);
	custom_require_cache.set(
		path,
		result = require(path_real)
	);
	return result;
}
const custom_import = async path => {
	let result = custom_import_cache.get(path);
	if (result != null) return result;

	log_verbose && log('import module: ' + path);
	custom_import_cache.set(
		path,
		result = await import(
			'file://' + require.resolve(path, RESOLVE_OPTIONS)
		)
	);
	return result;
}
actions.module_cache_clear = () => {
	for (const path of custom_require_paths) {
		delete require.cache[path];
	}
	custom_require_cache.clear();
	custom_import_cache.clear();
}
const AsyncFunction = custom_import.constructor;

const services = new Map;
let services_loaded_promise = null;
let services_loaded_promise_resolve = null;
/**
	stop/start services according to list
*/
const services_list_react = async list => {
	// stop all services not in list
	await Promise.all(
		[...services.values()]
			.filter(service_object => (
				service_object.status < SERVICE_STATUS_STOPPING &&
				!list.includes(service_object.path)
			))
			// so they will not be restarted
			.map(service_object => (
				service_object.dependencies = null,
				service_object
			))
			.map(service_stop)
	);
	// start all services in list
	const start_queue = [];
	for (const path of list) {
		let service_object = services.get(path);
		if (service_object == null) {
			services.set(path, service_object = {
				content: null,
				dependencies: null,
				dependencies_paths: null,
				file_function: null,
				handler_stop: null,
				path,
				promise_deps: null,
				promise_deps_resolve: null,
				promise_stopped: null,
				promise_stopped_resolve: null,
				status: SERVICE_STATUS_PENDING,
				watcher: null,
			});
		}
		else if (service_object.status < SERVICE_STATUS_STOPPING) continue;
		start_queue.push(service_object);
	}
	await Promise.all(
		start_queue.map(service_start)
	);
}
const services_shutdown = () => (
	Promise.all(
		[...services.values()]
			// so they will not be restarted
			.map(service_object => (
				service_object.dependencies = null,
				service_object
			))
			.map(service_stop)
	)
)
/**
	(re)start service
*/
const service_start = async service_object => {
	if (!services_loaded_promise) {
		services_loaded_promise = new Promise(resolve => {
			services_loaded_promise_resolve = resolve;
		});
	}
	const {path} = service_object;
	if (log_verbose) log(path + ': prepare for (re)start');
	let start_interval = 0;
	try {
		// if service is running, stop it
		if (
			service_object.status === SERVICE_STATUS_WAITING ||
			service_object.status === SERVICE_STATUS_STARTING
		) {
			if (log_verbose) log(path + ': abort previous start');
			service_object.status = SERVICE_STATUS_PENDING;
			if (service_object.promise_deps_resolve) {
				service_object.promise_deps_resolve();
			}
		}
		else if (service_object.status === SERVICE_STATUS_ACTIVE) {
			service_object.status = SERVICE_STATUS_PENDING;
			// restart all depending services
			for (const other of services.values())
			if (
				(
					other.status === SERVICE_STATUS_STARTING ||
					other.status === SERVICE_STATUS_ACTIVE
				) &&
				other.dependencies &&
				other.dependencies.includes(service_object)
			) {
				other.dependencies = null;
				service_start(other);
			}
			service_stop_inner(service_object);
		}
		await service_object.promise_stopped;
		// service is not running, now start it
		if (service_object.status > SERVICE_STATUS_ACTIVE) {
			service_object.status = SERVICE_STATUS_PENDING;
		}
		service_object.promise_stopped = new Promise(resolve => {
			service_object.promise_stopped_resolve = resolve;
		});
		if (!service_object.file_function) {
			const path_real = PATH_PUBLIC + path + '.service.js';
			const file_content = await fsp.readFile(path_real, 'utf8');
			if (service_object.status !== SERVICE_STATUS_PENDING) return;
			if (!service_object.watcher) {
				let timeout = 0;
				service_object.watcher = fs_watch(path_real, WATCH_OPTIONS, () => (
					clearTimeout(timeout),
					timeout = setTimeout(() => (
						log_verbose && log('file updated: ' + path),
						service_object.file_function = null,
						service_start(service_object)
					), 50)
				));
			}

			if (file_content.includes('globals.')) {
				log(`[deprecated] ${path}: uses globals object`);
			}

			service_object.dependencies_paths = [];
			for (let [, dep] of file_content.matchAll(SERVICE_REQUIRE_REG)) {
				const first_char = dep.charCodeAt(0);
				const last_char = dep.charCodeAt(dep.length - 1);
				if (
					dep.length <3 ||
					(first_char !== 34 || last_char !== 34) && // "
					(first_char !== 39 || last_char !== 39) // '
				) {
					throw new Error('service_require() needs inline string');
				}
				if (
					!service_object.dependencies_paths.includes(
						dep = dep.slice(1, -1)
					)
				) {
					service_object.dependencies_paths.push(dep);
				}
			}

			service_object.file_function = new AsyncFunction(
				'require',
				'custom_import',
				'service_require',
				'service_require_try',
				`const log=a=>rtjscomp.log(${
					JSON.stringify(path + ': ')
				}+a);${
					file_content
						.replace(IMPORT_REG, 'custom_import(')
				}`
			);
		}

		service_object.dependencies = [];
		let waiting_needed = false;
		for (const dep_path of service_object.dependencies_paths) {
			const dep = services.get(dep_path);
			if (dep == null) {
				throw new Error('unknown required service: ' + dep_path);
			}
			service_object.dependencies.push(dep);
			waiting_needed = (
				waiting_needed ||
				dep.status !== SERVICE_STATUS_ACTIVE
			);
		}
		if (waiting_needed) {
			if (log_verbose) log(path + ': wait for dependencies');
			service_object.status = SERVICE_STATUS_WAITING;
			service_object.promise_deps = new Promise(resolve => {
				service_object.promise_deps_resolve = resolve;
			});
			await service_object.promise_deps;
			if (service_object.status !== SERVICE_STATUS_WAITING) return;
		}

		log('start service: ' + path);
		service_object.status = SERVICE_STATUS_STARTING;
		start_interval = setInterval(() => {
			log(`[warning] ${path}: still starting`);
		}, 5e3);
		const content_object = service_object.content = {};
		const result = await service_object.file_function.call(
			content_object,
			custom_require,
			custom_import,
			service_require,
			service_require_try,
		);
		if (service_object.status !== SERVICE_STATUS_STARTING) return;
		if (typeof result === 'function') {
			service_object.handler_stop = result;
		}
		const handler_start = content_object.start;
		if (handler_start) {
			log(`[deprecated] ${path}: has start method`);
			delete content_object.start;
			await handler_start();
			if (service_object.status !== SERVICE_STATUS_STARTING) return;
		}
		if (content_object.stop) {
			log(`[deprecated] ${path}: has stop method`);
			service_object.handler_stop = content_object.stop;
			delete content_object.stop;
		}

		if (log_verbose) log('started service: ' + path);
		service_object.status = SERVICE_STATUS_ACTIVE;
	}
	catch (err) {
		if (!(err instanceof Error)) {
			err = new Error(err + '?! wtf');
		}
		log(`[error] ${
			path
		}${
			linenumber_try(err)
		}: ${
			err.message
		}`);
		service_object.status = SERVICE_STATUS_FAILED;
		service_object.dependencies = null;
		return;
	}
	finally {
		clearInterval(start_interval);
		service_object.promise_deps =
		service_object.promise_deps_resolve = null;
		if (service_object.status !== SERVICE_STATUS_ACTIVE) {
			service_object.promise_stopped_resolve();
			services_loaded_promise_try();
		}
	}

	// restart waiting services
	other: for (const other of services.values())
	if (other.status === SERVICE_STATUS_WAITING) {
		for (const dep of other.dependencies)
		if (dep.status !== SERVICE_STATUS_ACTIVE) {
			continue other;
		}
		other.promise_deps_resolve();
	}
	services_loaded_promise_try();
}
/**
	check if any loading services are left
*/
const services_loaded_promise_try = () => {
	if (!services_loaded_promise) return;
	for (const service_object of services.values())
	if (
		service_object.status < SERVICE_STATUS_ACTIVE
	) return;
	services_loaded_promise_resolve();
	services_loaded_promise =
	services_loaded_promise_resolve = null;
}
/**
	stop and forget service
*/
const service_stop = async service_object => {
	log('stop service: ' + service_object.path);
	service_object.status = SERVICE_STATUS_STOPPING;
	service_object.file_function = null;
	if (service_object.watcher) {
		service_object.watcher.close();
	}

	for (const other of services.values())
	if (
		other.dependencies &&
		other.dependencies.includes(service_object)
	) {
		other.dependencies = null;
		if (other.status !== SERVICE_STATUS_STOPPING) {
			service_start(other);
		}
	}

	if (service_object.promise_deps_resolve) {
		service_object.promise_deps_resolve();
	}
	else {
		await service_stop_inner(service_object);
	}
	services.delete(service_object.path);
	if (log_verbose) log('stopped service: ' + service_object.path);
}
/**
	stop service so it can be forgot or restarted
*/
const service_stop_inner = async service_object => {
	const {
		handler_stop,
		path,
	} = service_object;
	if (handler_stop) {
		service_object.handler_stop = null;
		const stop_interval = setInterval(() => {
			log(`[warning] ${path}: still stopping`);
		}, 1e3);
		try {
			await handler_stop();
		}
		catch (err) {
			log(`[error] ${
				path
			}${
				linenumber_try(err)
			} stop handler: ${
				err.message
			}`);
			service_object.status = SERVICE_STATUS_FAILED;
		}
		clearInterval(stop_interval);
	}
	service_object.promise_stopped_resolve();
}
const service_require = path => {
	const service_object = services.get(path);
	if (
		service_object != null &&
		service_object.status === SERVICE_STATUS_ACTIVE
	) return service_object.content;
	throw new Error('service required: ' + path);
}
const service_require_try = path => {
	const service_object = services.get(path);
	return (
		service_object != null &&
		service_object.status === SERVICE_STATUS_ACTIVE
		?	service_object.content
		:	null
	);
}

const file_watch_once = (path, callback) => {
	const watcher = fs_watch(path, WATCH_OPTIONS, () => (
		watcher.close(),
		log_verbose && log('file updated: ' + path),
		callback()
	));
};
const file_keep_new = async (path, callback) => {
	try {
		const data = await fsp.readFile(path, 'utf8');
		if (log_verbose) log('load file: ' + path);
		await callback(data);
	}
	catch (err) {
		await callback(null);
		return null;
	}

	let timeout = 0;
	return fs_watch(path, WATCH_OPTIONS, () => (
		clearTimeout(timeout),
		timeout = setTimeout(() => exiting || (
			log_verbose && log('file updated: ' + path),
			fsp.readFile(path, 'utf8')
				.catch(() => null)
				.then(callback)
		), 50)
	));
}

const get_prop_bool = (obj, prop, fallback) => {
	if (
		obj === null ||
		!(prop in obj)
	) return fallback;
	const value = obj[prop];
	if (typeof value !== 'boolean') {
		throw prop + ' must be boolean';
	}
	delete obj[prop];
	return value;
}
const get_prop_uint = (obj, prop, fallback) => {
	if (
		obj === null ||
		!(prop in obj)
	) return fallback;
	const value = obj[prop];
	if (
		typeof value !== 'number' ||
		value < 0 ||
		value % 1 > 0
	) {
		throw prop + ' must be positive integer';
	}
	delete obj[prop];
	return value;
}
const get_prop_list = (obj, prop) => {
	if (
		obj === null ||
		!(prop in obj)
	) return null;
	const value = obj[prop];
	if (
		typeof value !== 'object' ||
		!value ||
		value.length == null ||
		value.some(item => typeof item !== 'string')
	) {
		throw prop + ' must be array of strings';
	}
	delete obj[prop];
	return value;
}
const get_prop_map = (obj, prop) => {
	if (
		obj === null ||
		!(prop in obj)
	) return null;
	let value = obj[prop];
	if (
		typeof value !== 'object' ||
		!value ||
		(
			value = Object.entries(value)
		).some(([_, item]) => typeof item !== 'string')
	) {
		throw prop + ' must be object of strings';
	}
	delete obj[prop];
	return value;
}
const parse_old_list = data => (
	data
		.split('\n')
		.filter(entry =>
			entry.length > 0 &&
			entry.charCodeAt(0) !== 35
		)
)
const parse_old_map = data => (
	Object.fromEntries(
		data
			.split('\n')
			.filter(entry =>
				entry.length > 0 &&
				entry.charCodeAt(0) !== 35
			)
			.map(entry => entry.split(':'))
	)
)
const config_path_check = (path, allow_empty = false) => {
	if (!allow_empty && !path) {
		throw 'path is empty';
	}
	if (path.charCodeAt(0) === 47) {
		throw 'path must not start with /';
	}
	if (path.charCodeAt(path.length - 1) === 47) {
		throw 'path must not end with /';
	}
	if (path.includes('..')) {
		throw 'path must not contain ..';
	}
	if (path.includes('~')) {
		throw 'path must not contain ~';
	}
	if (path.includes('//')) {
		throw 'path must not contain //';
	}
}

let log_history = rtjscomp.log_history = [];
actions.log_clear = () => {
	log_history = rtjscomp.log_history = [];
}
const log = rtjscomp.log = msg => (
	console.log(msg),
	log_history.push(msg),
	spam_enabled ? spam('log', [msg]) : undefined
)

const spam_enabled = fs.existsSync('spam.csv');
rtjscomp.spam_history = '';
actions.spam_save = async (muted = false) => {
	if (!spam_enabled) return;

	try {
		const tmp = rtjscomp.spam_history;
		rtjscomp.spam_history = '';
		await fsp.appendFile('spam.csv', tmp, 'utf8');
		if (log_verbose && !muted) log('spam.csv saved');
	}
	catch (err) {
		log('[error] cannot save spam.csv: ' + err.message);
	}
}
const spam = (type, data) => {
	rtjscomp.spam_history += (
		Date.now() +
		',' +
		type +
		',' +
		JSON.stringify(data) +
		'\n'
	);

	if (rtjscomp.spam_history.length >= 1e5) {
		actions.spam_save();
	}
}

const request_handle = async (request, response, https) => {
	const request_method = request.method;
	const request_headers = request.headers;
	const request_ip = request_ip_get(request).clientIp;
	const request_method_head = request_method === 'HEAD';

	if ('x-forwarded-proto' in request_headers) {
		https = request_headers['x-forwarded-proto'] === 'https';
	}

	if (spam_enabled) spam('request', [https, request.url, request_ip]);

	try {
		const request_url_parsed = url.parse(request.url, false);

		let path = request_url_parsed.pathname || '/';
		if (
			path.charCodeAt(0) !== 47 ||
			path.includes('//')
		) throw 404;
		if (path.length > 1 && path.endsWith('/')) {
			path = path.slice(0, -1);
			// is file with extension?
			if (path.lastIndexOf('/') < path.lastIndexOf('.')) {
				response.setHeader('Location', path);
				throw 301;
			}
		}
		path = path.slice(1);

		// ignore (timeout) many hack attempts
		if (
			path.includes('php') ||
			path.includes('sql') ||
			path.includes('.git/') ||
			path_ghosts.has(path)
		) return;

		response.setHeader('Server', 'l3p3 rtjscomp v' + VERSION);
		response.setHeader('Access-Control-Allow-Origin', '*');

		let path_params = null;
		let request_body_promise = null;

		if (path_aliases_reverse.has(path)) {
			response.setHeader('Location', path_aliases_reverse.get(path));
			throw 301;
		}
		if (path_aliases.has(path)) {
			path = path_aliases.get(path)
		}
		else { // aliases with *
			const path_split = path.split('/');
			const templates = path_aliases_templates.get(
				path_split.shift()
			);
			if (templates != null)
			template: for (const template of templates) {
				const template_path = template.path_split;
				const template_path_length = template_path.length;
				if (template_path_length !== path_split.length) continue;
				const params = {};
				for (let i = 0; i < template_path_length; ++i) {
					if (template_path[i].charCodeAt(0) === 42) {
						if (template_path[i].length > 1) {
							params[
								template_path[i].slice(1)
							] = path_split[i];
						}
					}
					else if (template_path[i] !== path_split[i]) {
						continue template;
					}
				}
				path = template.value;
				path_params = params;
				break;
			}
		}

		const file_type_index = path.lastIndexOf('.');
		if (
			path.includes('..') ||
			path.includes('~') ||
			// no type ending -> dir?
			file_type_index <= path.lastIndexOf('/')
		) throw 404;
		const file_type = path.slice(
			file_type_index + 1
		).toLowerCase();

		let file_compression = COMPRESS_METHOD_NONE;

		const file_dyn_enabled = (
			type_dynamics.has(file_type) &&
			!path_statics.has(path)
		);

		if (
			!request_method_head &&
			request_method !== 'GET'
		) {
			if (!file_dyn_enabled) throw 405;
			if ('content-length' in request_headers) {
				request_body_promise = new Promise(resolve => {
					const request_body_chunks = [];
					request.on('data', chunk => {
						request_body_chunks.push(chunk);
					});
					request.on('end', chunk => {
						chunk && request_body_chunks.push(chunk);
						resolve(Buffer.concat(request_body_chunks));
					});
				});
			}
		}

		let file_function = null;
		let file_stat = null;
		const path_real = PATH_PUBLIC + path;

		if (
			file_dyn_enabled &&
			file_cache_functions.has(path)
		) {
			file_function = file_cache_functions.get(path);
		}
		else {
			if (log_verbose) log(`load ${
				file_dyn_enabled
				?	'dynam'
				:	'stat'
			}ic file: ${path}`);

			if (
				path_hiddens.has(path) ||
				path.endsWith('.service.js')
			) throw 403;
			if (!fs.existsSync(path_real)) throw 404;
			file_stat = fs.statSync(path_real);
			if (file_stat.isDirectory()) throw 403;

			if (file_dyn_enabled) { // compile file
				const file_content = await fsp.readFile(path_real, 'utf8');
				try {
					if (file_content.includes('\r')) {
						throw 'illegal line break, must be unix';
					}
					if (
						file_content.includes('response.write(') ||
						file_content.includes('response.end(')
					) {
						throw 'response.write() not allowed, use output.write()';
					}
					if (file_content.includes('globals.')) {
						log(`[deprecated] ${path}: uses globals object`);
					}
					const file_content_length = file_content.length;

					let code = `const log=a=>rtjscomp.log(${
						JSON.stringify(path + ': ')
					}+a);`;

					let section_dynamic = false;
					let index_start = 0;
					let index_end = 0;

					while (index_end < file_content_length) {
						if (section_dynamic) {
							if (
								(
									index_end = file_content.indexOf(
										'?>',
										// skip `<?`
										index_start = index_end + 2
									)
								) < 0
							) throw '"?>" missing';
							section_dynamic = false;
							// section not empty?
							if (index_start < index_end) {
								// `<?`?
								if (file_content.charCodeAt(index_start) !== 61) {
									code += (
										file_content
											.slice(
												index_start,
												index_end
											)
											.replace(IMPORT_REG, 'custom_import(') +
										';'
									);
								}
								else { // `<?=`?
									code += `output.write(''+(${
										file_content
											.slice(
												++index_start,
												index_end
											)
											.replace(IMPORT_REG, 'custom_import(')
									}));`;
								}
							}
							// skip `?>`
							index_end += 2;
						}
						else { // static section
							// still something dynamic coming?
							if (
								(
									index_end = file_content.indexOf(
										'<?',
										index_start = index_end
									)
								) > -1
							) {
								section_dynamic = true;
							}
							else {
								index_end = file_content_length;
							}

							// section not empty?
							if (index_start < index_end) {
								code += `output.write(${
									JSON.stringify(
										file_content.slice(index_start, index_end)
									)
								});`;
							}
						}
					}

					try {
						file_function = new AsyncFunction(
							'input',
							'output',
							'request',
							'response',
							'require',
							'custom_import',
							'service_require',
							'service_require_try',
							code
						);
					}
					catch (err) {
						throw err.message;
					}
				}
				catch (err) {
					log(`[error] ${path} compile: ${err}`);
					throw 500;
				}

				file_cache_functions.set(path, file_function);
				file_watch_once(path_real, () => (
					file_cache_functions.delete(path)
				));
			}
		}

		response.statusCode = 200;
		response.setHeader(
			'Content-Type',
			type_mimes.get(file_type) || type_mimes.get('txt')
		);

		if (file_dyn_enabled) { // dynamic file
			const file_function_input = path_params || {};

			if (request_headers['cookie'])
			for (let cookie of request_headers['cookie'].split(';')) {
				cookie = cookie.trim();
				const index_equ = cookie.indexOf('=');
				if (index_equ > 0) {
					file_function_input[
						cookie
							.slice(0, index_equ)
							.trimRight()
					] = decodeURI(
						cookie
							.slice(index_equ + 1)
							.trimLeft()
					);
				}
				else if (index_equ < 0) {
					file_function_input[cookie] = undefined;
				}
			}

			if (request_headers['x-input']) {
				Object.assign(
					file_function_input,
					querystring_parse(request_headers['x-input'])
				);
			}

			if (request_url_parsed.query) {
				try {
					Object.assign(
						file_function_input,
						querystring_parse(request_url_parsed.query)
					);
				}
				catch (err) {
					log(`[error] ${path} request query: ${err.message}`);
					throw 400;
				}
			}

			if (request_body_promise) {
				try {
					const content_type = request.headers['content-type'] || '';
					const body_raw = file_function_input['body'] = await request_body_promise;
					let body = null;
					switch (content_type.split(';')[0]) {
						case 'application/x-www-form-urlencoded':
							body = querystring_parse(body_raw.toString());
							break;
						case 'application/json':
							body = JSON.parse(body_raw.toString());
							break;
						case 'multipart/form-data': {
							body = Object.fromEntries(
								multipart_parse(
									body_raw,
									content_type.split('boundary=')[1].split(';')[0]
								)
									.map(value => {
										const {name} = value;
										delete value.name;
										return [
											name,
											value.type ? value : value.data.toString()
										];
									})
							);
						}
					}
					if (body) {
						Object.assign(file_function_input, /** @type {!Object} */ (body));
					}
				}
				catch (err) {
					log(`[error] ${path} request body: ${err.message}`);
					throw 400;
				}
			}

			file_function_input['https'] = https;
			file_function_input['ip'] = request_ip;
			file_function_input['method'] = (
				request_method_head
				?	'get'
				:	request_method.toLowerCase()
			);
			file_function_input['path'] = request_url_parsed.pathname;
			file_function_input['user_agent'] = request_headers['user-agent'];

			let file_function_output = response;
			response.setHeader('Cache-Control', 'no-cache, no-store');

			if (
				compression_enabled &&
				'accept-encoding' in request_headers &&
				!type_raws.has(file_type)
			) {
				const encodings = request_headers['accept-encoding'].split(HTTP_LIST_REG);
				if (
					HAS_ZSTD &&
					encodings.includes('zstd')
				) {
					file_compression = COMPRESS_METHOD_ZSTD;
					response.setHeader('Content-Encoding', 'zstd');
					if (!request_method_head) {
						(
							file_function_output = zlib.createZstdCompress(ZSTD_OPTIONS)
						).pipe(response);
					}
				}
				else if (
					HAS_BROTLI &&
					encodings.includes('br')
				) {
					file_compression = COMPRESS_METHOD_BROTLI;
					response.setHeader('Content-Encoding', 'br');
					if (!request_method_head) {
						(
							file_function_output = zlib.createBrotliCompress()
						).pipe(response);
					}
				}
				else if (encodings.includes('gzip')) {
					file_compression = COMPRESS_METHOD_GZIP;
					response.setHeader('Content-Encoding', 'gzip');
					if (!request_method_head) {
						(
							file_function_output = zlib.createGzip(GZIP_OPTIONS)
						).pipe(response);
					}
				}
			}

			if (spam_enabled) spam('execute', [
				path,
				Object.fromEntries(
					Object.entries(file_function_input)
						.filter(e => e[0] !== 'body')
						.map(e => e[0] === 'password' ? [e[0], '***'] : e)
						.map(e => e[0] === 'file' ? [e[0], '...'] : e)
						.map(e => (typeof e[1] === 'object' && !e[1].length) ? [e[0], Object.keys(e[1]).slice(0, 20)] : e)
						.map(e => (e[0] !== 'user_agent' && typeof e[1] === 'string' && e[1].length > 20) ? [e[0], e[1].slice(0, 20) + '...'] : e)
				)
			]);

			if (request_method_head) {
				file_function_output.write =
				file_function_output.end = () => {
					throw null;
				}
			}

			await services_loaded_promise;

			let returned;
			try {
				returned = await file_function(
					file_function_input,
					file_function_output,
					request,
					response,
					custom_require,
					custom_import,
					service_require,
					service_require_try,
				);
			}
			catch (err) {
				if (err instanceof Error) {
					log(`[error] ${path}: ${err.message}`);
					returned = (
						err.message.startsWith('service required: ')
						?	503
						:	500
					);
				}
				else if (typeof err === 'number') {
					log(`[deprecated] ${path}: status code thrown, use return instead`);
					returned = err;
				}
				else if (err !== null) {
					log(`[error] ${path}: invalid throw type: ${typeof err}`);
					returned = 500;
				}
			}
			if (request_method_head) {
				delete file_function_output.write;
				delete file_function_output.end;
			}
			if (returned != null) {
				if (response.headersSent) {
					if (
						response.writableEnded != null
						?	!response.writableEnded
						:	!response.finished
					) {
						file_function_output.end(`${
							file_type === 'html'
							?	'<hr>'
							:	'\n\n---\n'
						}ERROR!`);
					}
				}
				else if (file_compression !== COMPRESS_METHOD_NONE) {
					response.removeHeader('Content-Encoding');
				}
				if (typeof returned !== 'number') {
					log(`[error] ${path}: invalid return type: ${typeof returned}`);
					throw 500;
				}
				if (response.headersSent) {
					if (returned < 500) {
						log(`[error] ${path}: status code after content`);
						throw 500;
					}
				}
				throw returned;
			}
			file_function_output.end();
		}
		else { // static file
			const compression_enabled_type = (
				compression_enabled &&
				!type_raws.has(file_type)
			);
			let path_real_send = path_real;

			if (
				compression_enabled_type &&
				'accept-encoding' in request_headers
			) {
				const encodings = request_headers['accept-encoding'].split(HTTP_LIST_REG);
				if (
					encodings.includes('zstd') &&
					fs.existsSync(path_real + '.zst')
				) {
					file_compression = COMPRESS_METHOD_ZSTD;
					path_real_send += '.zst';
				}
				else if (
					encodings.includes('br') &&
					fs.existsSync(path_real + '.br')
				) {
					file_compression = COMPRESS_METHOD_BROTLI;
					path_real_send += '.br';
				}
				else if (
					encodings.includes('gzip') &&
					fs.existsSync(path_real + '.gz')
				) {
					file_compression = COMPRESS_METHOD_GZIP;
					path_real_send += '.gz';
				}
			}

			if (spam_enabled) spam('static_send', [path, file_compression]);
			response.setHeader('Cache-Control', 'public, max-age=600');
			if (compression_enabled_type) {
				response.setHeader('Vary', 'Accept-Encoding');
			}

			switch (file_compression) {
			case COMPRESS_METHOD_NONE:
				response.setHeader('Content-Length', file_stat.size);
				break;
			case COMPRESS_METHOD_GZIP:
				response.setHeader('Content-Encoding', 'gzip');
				break;
			case COMPRESS_METHOD_BROTLI:
				response.setHeader('Content-Encoding', 'br');
				break;
			case COMPRESS_METHOD_ZSTD:
				response.setHeader('Content-Encoding', 'zstd');
				break;
			}

			if (request_method_head) {
				response.end();
			}
			else {
				fs.createReadStream(path_real_send)
					.pipe(response);
			}
		}
	}
	catch (err) {
		// catch internal errors
		if (typeof err !== 'number') {
			console.error(err);
			err = 500;
		}

		if (
			err >= 500 ||
			log_verbose && err >= 400
		) {
			log(`[error] request failed: ${err}; ${request_ip}; ${request.url}`);
		}

		if (!response.headersSent) {
			response.writeHead(err, {
				'Content-Type': 'text/html',
				'Cache-Control': 'no-cache, no-store',
			});
			response.end(`<!DOCTYPE html><html><body><h1>HTTP ${
				err
			}: ${
				http.STATUS_CODES[err] || 'Error'
			}</h1></body></html>`);
		}
	}
}

actions.halt = async () => {
	exiting = true;
	if (log_verbose) log('stop all');
	await Promise.all([
		actions.http_stop && actions.http_stop(),
		actions.https_stop && actions.https_stop(),
		services_shutdown(),
	]);
	await actions.spam_save();
	log('stopped all');
}
actions.exit = async status => {
	if (exiting) return;
	if (typeof status !== 'number') status = 0;
	await actions.halt();
	if (log_verbose) log('exit');
	process.exit(status);
}

process.on('uncaughtException', err => {
	if (typeof err === 'symbol') err = err.toString();
	log('[error] uncaughtException: ' + (err.message || err));
	console.error(err);
	if (exiting) process.exit(1);
	actions.exit(1);
});
process.on('unhandledRejection', err => {
	log('[error] unhandledRejection: ' + (err.message || err));
	console.error(err);
	if (exiting) process.exit(1);
	actions.exit(1);
});
process.on('exit', actions.exit);
process.on('SIGINT', actions.exit);
//process.on('SIGUSR1', actions.exit);
process.on('SIGUSR2', actions.exit);
process.on('SIGTERM', actions.exit);

log(`rtjscomp v${
	VERSION
} in ${
	IS_BUN ? 'bun' : 'node'
} on ${
	process.platform
		.replace('win32', 'windows')
}`);
if (log_verbose && !HAS_BROTLI) log('[hint] brotli not available');
if (log_verbose && !HAS_ZSTD) log('[hint] zstd not available');

await file_keep_new(PATH_CONFIG + 'init.js', async data => {
	if (!data) return;
	log('[deprecated] run global init script');
	try {
		await (
			new AsyncFunction('require', data)
		)(custom_require);
	}
	catch (err) {
		log('[error] init.js: ' + err.message);
	}
});

// initial
{
	const [
		stat_data,
		stat_public,
		...files_config
	] = await Promise.all([
		fsp.stat(PATH_DATA).catch(_ => null),
		fsp.stat(PATH_PUBLIC).catch(_ => null),
		...(
			'file_blocks,file_privates,file_raws,file_type_dyns,file_type_mimes,file_type_nocompress,path_aliases,port_http,port_https,services'
			.split(',')
			.map(name => fsp.readFile(PATH_CONFIG + name + '.txt', 'utf8').catch(_ => null))
		),
	]);

	if (!stat_data) {
		fs.mkdirSync(PATH_DATA);
	}
	if (!stat_public) {
		fs.cpSync(
			__dirname + '/' + PATH_PUBLIC,
			PATH_PUBLIC,
			{recursive: true}
		);
	}
	if (
		files_config.some(file => file !== null)
	) {
		const json = JSON.parse(
			await fsp.readFile('rtjscomp.json', 'utf8').catch(_ => null)
		) || {};

		const [
			old_file_blocks,
			old_file_privates,
			old_file_raws,
			old_file_type_dyns,
			old_file_type_mimes,
			old_file_type_nocompress,
			old_path_aliases,
			old_port_http,
			old_port_https,
			old_services,
		] = files_config;

		if (old_file_blocks) {
			json['path_ghosts'] = parse_old_list(old_file_blocks);
		}
		if (old_file_privates) {
			json['path_hiddens'] = parse_old_list(old_file_privates);
		}
		if (old_file_raws) {
			json['path_statics'] = parse_old_list(old_file_raws);
		}
		if (old_file_type_dyns) {
			json['type_dynamics'] = parse_old_list(old_file_type_dyns);
		}
		if (old_file_type_mimes) {
			json['type_mimes'] = parse_old_map(old_file_type_mimes);
		}
		if (old_file_type_nocompress) {
			json['type_raws'] = parse_old_list(old_file_type_nocompress);
		}
		if (old_path_aliases) {
			json['path_aliases'] = parse_old_map(old_path_aliases);
		}
		if (old_port_http) {
			const number = Number(old_port_http);
			if (!isNaN(number)) {
				json['port_http'] = number;
			}
		}
		if (old_port_https) {
			const number = Number(old_port_https);
			if (!isNaN(number)) {
				json['port_https'] = number;
			}
		}
		if (old_services) {
			json['services'] = old_services.split('\n').filter(path => path.length > 0);
		}

		await fsp.writeFile(
			'rtjscomp.json',
			JSON.stringify(json, null, '\t') + '\n',
			'utf8'
		);
		log('[deprecated] config files found, rtjscomp.json written, please delete config files');
	}
}

// http(s)
let connections_count = 0;
let http_status_target = false;
let http_listened_resolve = null;
const http_connections = new Map;
const server_http = http.createServer(
	(request, response) => request_handle(request, response, false)
);
server_http.on('error', err => {
	log('[error] http: ' + err.message);
	http_listened_resolve && http_listened_resolve();
});
server_http.on('connection', connection => {
	const id = ++connections_count;
	http_connections.set(id, connection);
	connection.on('close', () => {
		http_connections.delete(id);
	});
});

actions.http_start = async () => {
	await actions.http_stop();
	if (!port_http) return;
	http_status_target = true;
	log('start http: http://localhost:' + port_http);
	await new Promise(resolve => server_http.listen(port_http, http_listened_resolve = resolve));
	if (http_listened_resolve) http_listened_resolve = null;
	else if (log_verbose) log('started http');
}
actions.http_stop = async () => {
	if (!http_status_target) return;
	http_status_target = false;
	log('stop http');
	const kill_timeout = setTimeout(actions.http_kill, 5e3);
	await new Promise(resolve => server_http.close(resolve));
	clearTimeout(kill_timeout);
	if (log_verbose) log('stopped http');
}
actions.http_kill = async () => {
	if (http_status_target) return;
	log('kill http');
	await Promise.all(
		[...http_connections.values()]
			.map(connection => connection.destroy())
	);
	if (log_verbose) log('killed http');
	http_connections.clear();
}

try {
	const https_key = fs.readFileSync(PATH_CONFIG + 'ssl/domain.key');
	const https_cert = fs.readFileSync(PATH_CONFIG + 'ssl/chained.pem');
	let https_status_target = false;
	let https_listened_resolve = null;
	const https_connections = new Map;
	const server_https = require('https').createServer(
		{key: https_key, cert: https_cert},
		(request, response) => request_handle(request, response, true)
	);
	server_https.on('error', err => {
		log('[error] https: ' + err.message);
		https_listened_resolve && https_listened_resolve();
	});
	server_https.on('connection', connection => {
		const id = ++connections_count;
		https_connections.set(id, connection);
		connection.on('close', () => {
			https_connections.delete(id);
		});
	});

	actions.https_start = async () => {
		await actions.https_stop();
		if (!port_https) return;
		https_status_target = true;
		log('start https: https://localhost:' + port_https);
		await new Promise(resolve => server_https.listen(port_https, https_listened_resolve = resolve));
		if (https_listened_resolve) https_listened_resolve = null;
		else if (log_verbose) log('started https');
	}
	actions.https_stop = async () => {
		if (!https_status_target) return;
		https_status_target = false;
		log('stop https');
		const kill_timeout = setTimeout(actions.https_kill, 5000);
		await new Promise(resolve => server_https.close(resolve));
		clearTimeout(kill_timeout);
		if (log_verbose) log('stopped https');
	}
	actions.https_kill = async () => {
		if (https_status_target) return;
		log('kill https');
		await Promise.all(
			[...https_connections.values()]
				.map(connection => connection.destroy())
		);
		if (log_verbose) log('killed https');
		https_connections.clear();
	}
}
catch (err) {
	if (log_verbose) log('[hint] https: no cert, disabled');
}

// config
await file_keep_new('rtjscomp.json', data => {
	try {
		data = JSON.parse(data);
		if (typeof data !== 'object') {
			throw 'must contain {}';
		}

		const compression_enabled_new = get_prop_bool(data, 'compress', true);
		const gzip_level_new = get_prop_uint(data, 'gzip_level', 3);
		const log_verbose_new = get_prop_bool(data, 'log_verbose', log_verbose_flag);
		const path_aliases_new = get_prop_map(data, 'path_aliases');
		const path_ghosts_new = get_prop_list(data, 'path_ghosts');
		const path_hiddens_new = get_prop_list(data, 'path_hiddens');
		const path_statics_new = get_prop_list(data, 'path_statics');
		const port_http_new = get_prop_uint(data, 'port_http', 8080);
		const port_https_new = get_prop_uint(data, 'port_https', 0);
		const services_new = get_prop_list(data, 'services') || [];
		const type_dynamics_new = get_prop_list(data, 'type_dynamics');
		const type_mimes_new = get_prop_map(data, 'type_mimes');
		const type_raws_new = get_prop_list(data, 'type_raws');
		const zstd_level_new = get_prop_uint(data, 'zstd_level', 3);

		if (data) {
			const keys_left = Object.keys(data);
			if (keys_left.length > 0) {
				throw 'unknown: ' + keys_left.join(', ');
			}
		}
		if (gzip_level_new > 9) {
			throw 'gzip_level > 9';
		}
		if (zstd_level_new > 19) {
			throw 'zstd_level > 19';
		}
		if (
			port_http_new > 65535 ||
			port_https_new > 65535
		) {
			throw 'port > 65535';
		}

		compression_enabled = compression_enabled_new;
		GZIP_OPTIONS.level = compression_enabled ? gzip_level_new : 0;
		ZSTD_OPTIONS.params[ZSTD_c_compressionLevel] = zstd_level_new;
		log_verbose = log_verbose_new;
		if (path_ghosts_new) {
			path_ghosts.clear();
			for (const key of path_ghosts_new) {
				config_path_check(key);
				path_ghosts.add(key);
			}
		}
		if (path_hiddens_new) {
			path_hiddens.clear();
			for (const key of path_hiddens_new) {
				config_path_check(key);
				path_hiddens.add(key);
			}
		}
		if (path_statics_new) {
			path_statics.clear();
			for (const key of path_statics_new) {
				config_path_check(key);
				path_statics.add(key);
			}
		}
		if (path_aliases_new) {
			path_aliases.clear();
			path_aliases_reverse.clear();
			path_aliases_templates.clear();
			for (const [key, value] of path_aliases_new) {
				config_path_check(key, true);
				config_path_check(value);
				if (key.includes('*')) {
					const path_split = key.split('/');
					const first = path_split.shift();
					if (path_aliases_templates.has(first)) {
						path_aliases_templates.get(first).push(
							{path_split, value}
						);
					}
					else {
						path_aliases_templates.set(first, [
							{path_split, value},
						]);
					}
				}
				else {
					path_aliases.set(key, value);
					const existing = path_aliases_reverse.get(value);
					if (
						existing == null ||
						existing.length - 1 > value.length
					) {
						path_aliases_reverse.set(value, '/' + key);
					}
				}
			}
		}
		if (type_dynamics_new) {
			type_dynamics.clear();
			for (const key of type_dynamics_new) {
				type_dynamics.add(key);
			}
		}
		if (type_mimes_new) {
			for (const [key, value] of type_mimes_new) {
				type_mimes.set(key, value);
			}
		}
		if (type_raws_new) {
			type_raws.clear();
			for (const key of type_raws_new) {
				type_raws.add(key);
			}
		}

		for (const path of services_new) config_path_check(path);
		const promises = [
			services_list_react(
				services_new
					.filter(path => path.charCodeAt(0) !== 35)
			),
		];

		if (port_http_new !== port_http) {
			port_http = port_http_new;
			promises.push(
				port_http_new > 0
				?	actions.http_start()
				:	actions.http_stop()
			);
		}

		if (
			actions.https_stop != null &&
			port_https_new !== port_https
		) {
			port_https = port_https_new;
			promises.push(
				port_https_new > 0
				?	actions.https_start()
				:	actions.https_stop()
			);
		}

		return Promise.all(promises);
	}
	catch (err) {
		log('[error] rtjscomp.json: ' + (err.message || err));
	}
});

if (log_verbose) log('started all');

})();
