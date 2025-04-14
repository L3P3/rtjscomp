#!/usr/bin/env node
/**
	RTJSCOMP by L3P3, 2017-2025
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
const AGENT_CHECK_BOT = /bot|googlebot|crawler|spider|robot|crawling|favicon/i;
const AGENT_CHECK_MOBIL = /(android|bb\d+|meego).+mobile|avantgo|bada\/|blackberry|blazer|compal|elaine|fennec|hiptop|iemobile|ip(hone|od)|iris|kindle|lge |maemo|midp|mmp|mobile.+firefox|netfront|opera m(ob|in)i|palm( os)?|phone|p(ixi|re)\/|plucker|pocket|psp|series(4|6)0|symbian|treo|up\.(browser|link)|vodafone|wap|windows ce|xda|xiino|android|ipad|playbook|silk/i;
const GZIP_OPTIONS = {level: 9};
const HTTP_LIST_REG = /,\s*/;
const IMPORT_REG = /import\(/g;
const IS_BUN = typeof Bun !== 'undefined';
const PATH_CONFIG = 'config/';
const PATH_DATA = 'data/';
const PATH_PUBLIC = 'public/';
const RESOLVE_OPTIONS = {paths: [require('path').resolve()]};
const VERSION = require('./package.json').version;
const WATCH_OPTIONS = {persistent: true, interval: 1000};

// config
let log_verbose = process.argv.includes('-v');
let port_http = 0;
let port_https = 0;
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
	};
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
	return name.endsWith('.json') ? JSON.parse(data || null) : data;
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
		name.endsWith('.json') ? JSON.stringify(data) : data,
		'utf8'
	)
)

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

const services_active = new Map;
const services_loading = new Set;
const services_list_react = async list => {
	await Promise.all(
		Array.from(services_active.entries())
			.filter(([path, _]) => !list.includes(path))
			.map(([_, service_object]) => service_stop(service_object, true))
	);
	for (const path of list)
	if (
		path.charCodeAt(0) !== 35 &&
		!services_active.has(path)
	) {
		await service_start(path);
	}
}
const service_start = async path => {
	const service_object = {
		content: null,
		handler_stop: null,
		path,
		stopped: false,
		watcher: null,
	};

	service_object.watcher = await file_keep_new(
		PATH_PUBLIC + path + '.service.js',
		async file_content => {
			if (file_content === null) {
				log('[error] service file not found: ' + path);
				return service_stop(service_object, true);
			}
			if (services_loading.size > 0) {
				await Promise.all(Array.from(services_loading));
			}
			const start_promise = service_start_inner(path, service_object, file_content);
			services_loading.add(start_promise);
			await start_promise;
			services_loading.delete(start_promise);
		}
	);
}
const service_start_inner = async (path, service_object, file_content) => {
	if (services_active.has(path)) {
		await service_stop_handler(service_object);
	}
	const content_object = service_object.content = {};
	log('start service: ' + path);

	const start_interval = setInterval(() => {
		log(`[warning] ${path}: still starting`);
	}, 1e3);

	if (file_content.includes('globals.')) {
		log(`[deprecated] ${path}: uses globals object`);
	}

	try {
		const result = await (new AsyncFunction(
			'require',
			'custom_import',
			`const log=a=>rtjscomp.log(${
				JSON.stringify(path + ': ')
			}+a);${
				file_content.replace(IMPORT_REG, 'custom_import(') + '\n'
			}`
		)).call(content_object, custom_require, custom_import);
		if (service_object.stopped) {
			clearInterval(start_interval);
			return;
		}
		if (typeof result === 'function') {
			service_object.handler_stop = result;
		}
	}
	catch (err) {
		clearInterval(start_interval);
		log(`[error] ${path}: ${err.message}`);
		if (service_object.stopped) return;
		return service_stop(service_object, false);
	}

	const handler_start = content_object.start;
	if (handler_start) {
		log(`[deprecated] ${path}: has start method`);
		delete content_object.start;
		try {
			await handler_start();
		}
		catch (err) {
			clearInterval(start_interval);
			log(`[error] ${path} start: ${err.message}`);
			return service_stop(service_object, false);
		}
	}
	clearInterval(start_interval);

	if (content_object.stop) {
		log(`[deprecated] ${path}: has stop method`);
		service_object.handler_stop = content_object.stop;
		delete content_object.stop;
	}

	services_active.set(path, service_object);
	if (log_verbose) log('started service: ' + path);
}
const services_shutdown = () => (
	Promise.all(
		Array.from(services_active.values())
			.map(service_object => service_stop(service_object, true))
	)
)
const service_stop = (service_object, forget) => (
	service_object.stopped = true,
	forget && service_object.watcher &&
		service_object.watcher.close(),
	service_stop_handler(service_object)
)
const service_stop_handler = async service_object => {
	services_active.delete(service_object.path);
	log('stop service: ' + service_object.path);
	const handler_stop = service_object.handler_stop;
	if (handler_stop) {
		const stop_interval = setInterval(() => {
			log(`[warning] ${service_object.path}: still stopping`);
		}, 1e3);
		try {
			service_object.handler_stop = null;
			await handler_stop();
		}
		catch (err) {
			log(`[error] ${service_object.path} stop: ${err.message}`);
		}
		clearInterval(stop_interval);
	}
	if (log_verbose) log('stopped service: ' + service_object.path);
}
global.service_require = path => {
	const service = services_active.get(path);
	if (service != null) return service.content;
	throw new Error('service required: ' + path);
}
global.service_require_try = path => {
	const service = services_active.get(path);
	return (
		service != null
		?	service.content
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
		timeout = setTimeout(() => (
			log_verbose && log('file updated: ' + path),
			fsp.readFile(path, 'utf8')
				.catch(() => null)
				.then(callback)
		), 50)
	));
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
			response.setHeader('Location', path.slice(0, -1));
			throw 301;
		}
		path = path.slice(1);

		// ignore (timeout) many hack attempts
		if (
			path.includes('php') ||
			path.includes('sql') ||
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

		let file_gz_enabled = (
			'accept-encoding' in request_headers &&
			!type_raws.has(file_type) &&
			request_headers['accept-encoding'].split(HTTP_LIST_REG).includes('gzip')
		);

		const file_dyn_enabled = (
			type_dynamics.has(file_type) &&
			!path_statics.has(path)
		);

		if (request_method !== 'GET') {
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
			}ic file: ${path_real}`);

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
									.map(({ name, ...value }) => [
										name,
										value.type ? value : value.data.toString()
									])
							);
						}
					}
					if (body) {
						Object.assign(file_function_input, body);
					}
				}
				catch (err) {
					log(`[error] ${path} request body: ${err.message}`);
					throw 400;
				}
			}

			const request_headers_user_agent = file_function_input['user_agent'] = request_headers['user-agent'];
			file_function_input['bot'] = AGENT_CHECK_BOT.test(request_headers_user_agent);
			file_function_input['mobil'] = AGENT_CHECK_MOBIL.test(request_headers_user_agent);

			file_function_input['https'] = https;
			file_function_input['ip'] = request_ip;
			file_function_input['method'] = request_method.toLowerCase();
			file_function_input['path'] = request_url_parsed.pathname;

			let file_function_output;
			response.setHeader('Cache-Control', 'no-cache, no-store');

			if (file_gz_enabled) {
				response.setHeader('Content-Encoding', 'gzip');

				(
					file_function_output = zlib.createGzip(GZIP_OPTIONS)
				).pipe(response);
			}
			else {
				file_function_output = response;
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

			if (services_loading.size > 0) {
				await Promise.all(Array.from(services_loading));
			}

			try {
				await file_function(
					file_function_input,
					file_function_output,
					request,
					response,
					custom_require,
					custom_import
				);
				file_function_output.end();
			}
			catch (err) {
				if (err instanceof Error) {
					log(`[error] ${path}: ${err.message}`);

					if (err.message.startsWith('service required: ')) {
						err = 503;
					}
				}
				if (typeof err === 'number') {
					response.removeHeader('Content-Encoding');
					throw err;
				}

				file_function_output.end((
					file_type === 'html'
					?	'<hr>'
					:	'\n\n---\n'
				) + 'ERROR!');
			}
		}
		else { // static file
			let file_data = null;

			if (
				file_gz_enabled &&
				file_stat.size > 90 &&
				fs.existsSync(path_real + '.gz')
			) {
				file_data = fs.createReadStream(path_real + '.gz');
			}
			else {
				file_gz_enabled = false;
				file_data = fs.createReadStream(path_real);
			}

			if (spam_enabled) spam('static_send', [path, file_gz_enabled]);
			response.setHeader('Cache-Control', 'public, max-age=600');

			if (file_gz_enabled) {
				response.setHeader('Content-Encoding', 'gzip');
			}
			else {
				response.setHeader('Content-Length', file_stat.size);
			}

			file_data.pipe(response);
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

		response.writeHead(err, {
			'Content-Type': 'text/html',
			'Cache-Control': 'no-cache, no-store',
		});
		response.end(`<!DOCTYPE html><html><body><h1>HTTP ${err}: ${http.STATUS_CODES[err] || 'Error'}</h1></body></html>`);
	}
}

let exiting = false;
actions.halt = async () => {
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
	exiting = true;
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
}`);

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
			const number = parseInt(old_port_http);
			if (!isNaN(number)) {
				json['port_http'] = number;
			}
		}
		if (old_port_https) {
			const number = parseInt(old_port_https);
			if (!isNaN(number)) {
				json['port_https'] = number;
			}
		}
		if (old_services) {
			json['services'] = old_services.split('\n').filter(path => path.length > 0);
		}

		await fsp.writeFile(
			'rtjscomp.json',
			JSON.stringify(json, null, 2),
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
		Array.from(http_connections.values())
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
			Array.from(https_connections.values()).map(connection => connection.destroy())
		);
		if (log_verbose) log('killed https');
		https_connections.clear();
	}
}
catch (err) {
	if (log_verbose) log('https: no cert, disabled');
}

// config
await file_keep_new('rtjscomp.json', data => {
	try {
		data = JSON.parse(data);
		if (typeof data !== 'object') {
			throw 'must contain {}';
		}

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

		if (data) {
			const keys_left = Object.keys(data);
			if (keys_left.length > 0) {
				throw 'unknown: ' + keys_left.join(', ');
			}
		}

		if (path_ghosts_new) {
			path_ghosts.clear();
			for (const key of path_ghosts_new) {
				path_ghosts.add(key);
			}
		}
		if (path_hiddens_new) {
			path_hiddens.clear();
			for (const key of path_hiddens_new) {
				path_hiddens.add(key);
			}
		}
		if (path_statics_new) {
			path_statics.clear();
			for (const key of path_statics_new) {
				path_statics.add(key);
			}
		}
		if (path_aliases_new) {
			path_aliases.clear();
			path_aliases_reverse.clear();
			path_aliases_templates.clear();
			for (const [key, value] of path_aliases_new) {
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
					path_aliases_reverse.set(value, '/' + key);
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

		const promises = [
			services_list_react(services_new),
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
