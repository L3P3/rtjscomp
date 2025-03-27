#!/usr/bin/env node
/**
	RTJSCOMP by L3P3, 2017-2025
*/

"use strict";

(async () => {

const http = require('http');
const url = require('url');
const fs = require('fs');
const fsp = require('fs/promises');
const multipart_parse = require('parse-multipart-data').parse;
const zlib = require('zlib');
const request_ip_get = require('ipware')().get_ip;
const querystring_parse = require('querystring').decode;
const resolve_options = {paths: [require('path').resolve()]};

const VERSION = require('./package.json').version;
const PATH_PUBLIC = 'public/';
const PATH_CONFIG = 'config/';
const PATH_DATA = 'data/';
const GZIP_OPTIONS = {level: 9};
const AGENT_CHECK_BOT = /bot|googlebot|crawler|spider|robot|crawling|favicon/i;
const AGENT_CHECK_MOBIL = /(android|bb\d+|meego).+mobile|avantgo|bada\/|blackberry|blazer|compal|elaine|fennec|hiptop|iemobile|ip(hone|od)|iris|kindle|lge |maemo|midp|mmp|mobile.+firefox|netfront|opera m(ob|in)i|palm( os)?|phone|p(ixi|re)\/|plucker|pocket|psp|series(4|6)0|symbian|treo|up\.(browser|link)|vodafone|wap|windows ce|xda|xiino|android|ipad|playbook|silk/i;
const HTTP_LIST_REG = /,\s*/;
const IMPORT_REG = /import\(/g;

let log_verbose = process.argv.includes('-v');
let port_http = 0;
let port_https = 0;
const file_type_mimes = new Map;
const file_type_dyns = new Set;
const file_type_nocompress = new Set;
/// forced static files
const file_raws = new Set;
/// hidden files
const file_privates = new Set;
/// files where requests should be totally ignored
const file_blocks = new Set;
/// any path -> file
const path_aliases = new Map;
const path_aliases_templates = new Map;
const services = new Set;
/// compiled file handlers
const file_cache_functions = new Map;
const actions = {};
const rtjscomp = global.rtjscomp = {
	actions,
	version: VERSION,
};

if (!Object.fromEntries) {
	Object.fromEntries = entries => {
		const object = {};
		for (const entry of entries) object[entry[0]] = entry[1];
		return object;
	};
}

// legacy, will be removed soon!
global.globals = rtjscomp;
global.actions = rtjscomp.actions;
global.data_load = name => {
	log('[deprecated] synchronous load: ' + PATH_DATA + name);
	try {
		return fs.readFileSync(PATH_DATA + name, 'utf8');
	}
	catch (err) {
		return null;
	}
}
global.data_save = (name, data) => (
	log('[deprecated] synchronous save: ' + PATH_DATA + name),
	fs.writeFileSync(PATH_DATA + name, data, 'utf8')
)
global.number_check_int = number => (
	Math.floor(number) === number
)
global.number_check_uint = number => (
	number >= 0 && number_check_int(number)
)

rtjscomp.data_load = async name => {
	if (log_verbose) log('load: ' + PATH_DATA + name);
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
	log_verbose && log('save: ' + PATH_DATA + name),
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

	log_verbose && log('require: ' + path);
	const path_real = require.resolve(path, resolve_options);
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

	log_verbose && log('import: ' + path);
	custom_import_cache.set(
		path,
		result = await import(
			'file://' + require.resolve(path, resolve_options)
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

const services_active = new Map;
const services_loading = new Set;
const services_list_react = async () => {
	await Promise.all(
		Array.from(services_active.entries())
			.filter(([path, _]) => !services.has(path))
			.map(([_, service_object]) => service_stop(service_object, true))
	);
	for (const path of services)
	if (!services_active.has(path)) {
		await service_start(path);
	}
}
const service_start = async path => {
	const service_object = {
		content: null,
		handler_stop: null,
		path,
		stopped: false,
	};

	await file_keep_new(PATH_PUBLIC + path + '.service.js', async file_content => {
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
	});
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
		const fun = (0, eval)(
			`(async function(require,custom_import){const log=a=>rtjscomp.log(${
				JSON.stringify(path + ': ')
			}+a);${
				file_content.replace(IMPORT_REG, 'custom_import(') + '\n'
			}})`
		);
		const result = await fun.call(content_object, custom_require, custom_import);
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
	log_verbose && log('shutdown services...'),
	Promise.all(
		Array.from(services_active.values())
			.map(service_object => service_stop(service_object, true))
	)
)
const service_stop = async (service_object, forget) => {
	service_object.stopped = true;
	if (forget) fs.unwatchFile(PATH_PUBLIC + service_object.path + '.service.js');
	await service_stop_handler(service_object);
}
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

const map_generate_bol = (set, data) => {
	set.clear();
	for (const key of data.split('\n'))
	if (
		key.length > 0 &&
		key.charCodeAt(0) !== 35
	) {
		set.add(key);
	}
}
const map_generate_equ = (map, data) => {
	map.clear();
	for (const entry of data.split('\n'))
	if (
		entry.length > 0 &&
		entry.charCodeAt(0) !== 35
	) {
		const equ = entry.split(':');
		map.set(equ[0], equ[1] || '');
	}
}

const file_compare = (curr, prev, path) => (
	curr.mtime > prev.mtime && (
		log_verbose && log('file changed: ' + path),
		true
	)
)
const file_watch = (path, callback) => (
	fs.watchFile(path, (curr, prev) => {
		if (file_compare(curr, prev, path)) {
			fs.unwatchFile(path);
			callback();
		}
	})
)
const file_keep_new = async (path, callback) => {
	try {
		const data = await fsp.readFile(path, 'utf8');
		if (log_verbose) log('load file: ' + path);
		await callback(data);
		fs.watchFile(path, async (curr, prev) => {
			if (file_compare(curr, prev, path)) {
				await callback(
					await fsp.readFile(path, 'utf8').catch(() => null)
				);
			}
		});
	}
	catch (err) {
		await callback(null);
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

	if ('x-forwarded-proto' in request_headers) {
		https = request_headers['x-forwarded-proto'] === 'https';
	}

	if (spam_enabled) spam('request', [https, request.url, request_ip]);

	try {
		const request_url_parsed = url.parse(request.url, false);

		let path = request_url_parsed.pathname || '';

		// ignore (timeout) many hack attempts
		if (path.includes('php') || path.includes('sql')) return;

		// remove leading/trailing /
		while (path.charCodeAt(0) === 47) {
			path = path.substring(1);
		}
		while (path.charCodeAt(path.length - 1) === 47) {
			path = path.substring(0, path.length - 1);
		}

		if (path.includes('..') || path.includes('~')) throw 403;

		if (file_blocks.has(path)) return;

		response.setHeader('Server', 'l3p3 rtjscomp v' + VERSION);
		response.setHeader('Access-Control-Allow-Origin', '*');

		let path_params = null;
		let request_body_promise = null;

		if (path_aliases.has(path)) {
			response.setHeader(
				'Content-Location',
				path = path_aliases.get(path)
			);
		}
		else { // aliases with *
			const path_split = path.split('/');
			const templates = path_aliases_templates.get(path_split[0]);
			if (templates) {
				path_split.shift();
				template: for (const template_pair of templates) {
					const template = template_pair[0];
					const template_length = template.length;
					if (template_length !== path_split.length) continue;
					const params = {};
					for (let i = 0; i < template_length; ++i) {
						if (template[i].charCodeAt(0) === 42) {
							if (template[i].length > 1) params[template[i].substr(1)] = path_split[i];
						}
						else if (template[i] !== path_split[i]) continue template;
					}
					response.setHeader('Content-Location', path = template_pair[1]);
					path_params = params;
					break;
				}
			}
		}

		const file_type_index = path.lastIndexOf('.');
		// no type ending -> dir?
		if (file_type_index <= path.lastIndexOf('/')) throw 404;
		const file_type = path.substring(
			file_type_index + 1
		).toLowerCase();

		let file_gz_enabled = (
			'accept-encoding' in request_headers &&
			!file_type_nocompress.has(file_type) &&
			request_headers['accept-encoding'].split(HTTP_LIST_REG).includes('gzip')
		);

		const file_dyn_enabled = (
			file_type_dyns.has(file_type) &&
			!file_raws.has(path)
		);

		if (file_dyn_enabled) {
			if (
				request_method !== 'GET' &&
				'content-length' in request_headers
			) {
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
		else if (request_method !== 'GET') {
			throw 400;
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
				file_privates.has(path) ||
				path.endsWith('.service.js')
			) throw 403;
			if (!fs.existsSync(path_real)) throw 404;
			file_stat = fs.statSync(path_real);
			if (file_stat.isDirectory()) throw 403;

			if (file_dyn_enabled) { // compile file
				const file_content = fs.readFileSync(path_real, 'utf8');
				try {
					if (file_content.includes('\r')) {
						throw 'illegal line break, must be unix';
					}
					if (file_content.includes('globals.')) {
						log(`[deprecated] ${path}: uses globals object`);
					}
					const file_content_length = file_content.length;

					let code = `async (input,output,request,response,require,custom_import)=>{const log=a=>rtjscomp.log(${
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
											.substring(
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
											.substring(
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
										file_content.substring(index_start, index_end)
									)
								});`;
							}
						}
					}

					try {
						file_function = (0, eval)(code += '}');
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
				file_watch(path_real, () => {
					file_cache_functions.delete(path);
				});
			}
		}

		response.statusCode = 200;
		response.setHeader(
			'Content-Type',
			file_type_mimes.get(file_type) || file_type_mimes.get('txt')
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
							.substring(0, index_equ)
							.trimRight()
					] = decodeURI(
						cookie
							.substr(index_equ + 1)
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
						.map(e => (e[0] !== 'user_agent' && typeof e[1] === 'string' && e[1].length > 20) ? [e[0], e[1].substr(0, 20) + '...'] : e)
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

		if (err >= 400 && log_verbose) {
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
	await Promise.all([
		actions.http_stop && actions.http_stop(),
		actions.https_stop && actions.https_stop(),
		services_shutdown(),
	]);
	await actions.spam_save();
	log('stopped everything');
}
actions.exit = async status => {
	if (exiting) return;
	exiting = true;
	if (typeof status !== 'number') status = 0;
	await actions.halt();
	log('exiting...');
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

log(`rtjscomp v${VERSION} in ${typeof Bun === 'undefined' ? 'node' : 'bun'} on ${process.platform}`);

// initial
await Promise.all([
	fsp.stat(PATH_CONFIG).catch(_ => null),
	fsp.stat(PATH_DATA).catch(_ => null),
	fsp.stat(PATH_PUBLIC).catch(_ => null),
]).then(([stat_config, stat_data, stat_public]) => {
	if (!stat_config) {
		log('create config template directory');
		fs.mkdirSync(PATH_CONFIG);
		fs.mkdirSync(PATH_CONFIG + 'ssl');
		for (const file of 'file_type_dyns,file_type_mimes,file_type_nocompress,path_aliases,port_http,port_https,services'.split(',')) {
			fs.copyFileSync(
				__dirname + '/' + PATH_CONFIG + file + '.txt',
				PATH_CONFIG + file + '.txt'
			);
		}
	}
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
});

file_keep_new(PATH_CONFIG + 'services.txt', data => (
	map_generate_bol(services, data),
	services_list_react()
));

await Promise.all([
	file_keep_new(PATH_CONFIG + 'init.js', data => {
		if (!data) return;
		log('[deprecated] run global init script');
		try {
			var require = custom_require;
			(0, eval)(data);
		}
		catch (err) {
			log('[error] init.js: ' + err.message);
		}
	}),
	file_keep_new(PATH_CONFIG + 'file_type_mimes.txt', data => {
		map_generate_equ(file_type_mimes, data);
		if (!file_type_mimes.has('txt')) {
			file_type_mimes.set('txt', 'text/plain; charset=utf-8');
		}
	}),
	file_keep_new(PATH_CONFIG + 'path_aliases.txt', data => {
		map_generate_equ(path_aliases, data);
		path_aliases_templates.clear();
		for (const [key, value] of path_aliases.entries()) {
			const star_index = key.indexOf('*');
			if (star_index < 0) continue;
			path_aliases.delete(key);
			const template = key.split('/');
			const first = template.shift();
			if (path_aliases_templates.has(first)) {
				path_aliases_templates.get(first).push([template, value]);
			}
			else {
				path_aliases_templates.set(first, [
					[template, value],
				]);
			}
		}
	}),
	file_keep_new(PATH_CONFIG + 'file_type_dyns.txt', data => {
		map_generate_bol(file_type_dyns, data);
	}),
	file_keep_new(PATH_CONFIG + 'file_type_nocompress.txt', data => {
		map_generate_bol(file_type_nocompress, data);
	}),
	file_keep_new(PATH_CONFIG + 'file_raws.txt', data => {
		if (!data) return;
		map_generate_bol(file_raws, data);
	}),
	file_keep_new(PATH_CONFIG + 'file_privates.txt', data => {
		if (!data) return;
		map_generate_bol(file_privates, data);
	}),
	file_keep_new(PATH_CONFIG + 'file_blocks.txt', data => {
		if (!data) return;
		map_generate_bol(file_blocks, data);
	}),
]);

let connections_count = 0;
let http_status = false;
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
	http_status_target = true;
	log('start http: http://localhost:' + port_http);
	await new Promise(resolve => server_http.listen(port_http, http_listened_resolve = resolve));
	if (http_listened_resolve) http_listened_resolve = null;
	else{
		http_status = true;
		if (log_verbose) log('started http');
	}
}
actions.http_stop = async () => {
	if (!http_status_target) return;
	http_status_target = false;
	log('stop http');
	const kill_timeout = setTimeout(actions.http_kill, 5e3);
	await new Promise(resolve => server_http.close(resolve));
	clearTimeout(kill_timeout);
	http_status = false;
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

file_keep_new(PATH_CONFIG + 'port_http.txt', data => {
	if (
		!data ||
		isNaN(data = Number(data)) ||
		!number_check_uint(data)
	) {
		log('[error] http: invalid port number');
	}
	else if (data !== port_http) {
		port_http = data;
		actions.http_start();
	}
});

try {
	const https_key = fs.readFileSync(PATH_CONFIG + 'ssl/domain.key');
	const https_cert = fs.readFileSync(PATH_CONFIG + 'ssl/chained.pem');
	let https_status = false;
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
		https_status_target = true;
		log('start https: https://localhost:' + port_https);
		await new Promise(resolve => server_https.listen(port_https, https_listened_resolve = resolve));
		if (https_listened_resolve) https_listened_resolve = null;
		else{
			https_status = true;
			if (log_verbose) log('started https');
		}
	}
	actions.https_stop = async () => {
		if (!https_status_target) return;
		https_status_target = false;
		log('stop https');
		const kill_timeout = setTimeout(actions.https_kill, 5000);
		await new Promise(resolve => server_https.close(resolve));
		clearTimeout(kill_timeout);
		https_status = false;
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

	file_keep_new(PATH_CONFIG + 'port_https.txt', data => {
		if (
			!data ||
			isNaN(data = Number(data)) ||
			!number_check_uint(data)
		) {
			log('[error] https: invalid port number');
		}
		else if (data !== port_https) {
			port_https = data;
			actions.https_start();
		}
	});
}
catch (err) {
	if (log_verbose) log('https: no cert, disabled');
}

})();
