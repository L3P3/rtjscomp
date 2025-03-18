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
	log('[deprecated!] load: ' + name);
	try {
		return fs.readFileSync(PATH_DATA + name, 'utf8');
	}
	catch (err) {
		return null;
	}
}
global.data_save = (name, data) => (
	log('[deprecated!] save: ' + name),
	fs.writeFileSync(PATH_DATA + name, data, 'utf8')
)
global.number_check_int = number => (
	Math.floor(number) === number
)
global.number_check_uint = number => (
	number >= 0 && number_check_int(number)
)

rtjscomp.data_load = async name => {
	log('load: ' + name);
	const data = await fsp.readFile(PATH_DATA + name, 'utf8').catch(() => null);
	return name.endsWith('.json') ? JSON.parse(data || null) : data;
}
rtjscomp.data_load_watch = (name, callback) => (
	file_keep_new(PATH_DATA + name, data => (
		log('load: ' + name),
		callback(
			name.endsWith('.json')
			?	JSON.parse(data || null)
			:	data
		)
	))
)
rtjscomp.data_save = (name, data) => (
	log('save: ' + name),
	fsp.writeFile(
		PATH_DATA + name,
		name.endsWith('.json') ? JSON.stringify(data) : data,
		'utf8'
	)
)

const custom_require_cache = new Map;
const custom_require = path => {
	let result = custom_require_cache.get(path);
	if (result != null) return result;

	custom_require_cache.set(
		path,
		result = require(
			require.resolve(path, resolve_options)
		)
	);
	return result;
}

const services_active = new Map;
const services_list_react = async () => {
	await Promise.all(
		Array.from(services_active.entries())
			.filter(([path, _]) => !services.has(path))
			.map(([_, service_object]) => service_stop(service_object, true))
	);
	for (const path of services) {
		if (!services_active.has(path)) await service_start(path);
	}
}
const service_start = async path => {
	const service_object = {
		path,
		start: null,
		started: false,
		stop: null,
		stopped: false,
	};

	await file_keep_new(PATH_PUBLIC + path + '.service.js', async file_content => {
		if (file_content === null) {
			log('error, service file not found: ' + path);
			await service_stop(service_object, true);
			return;
		}
		await service_stop_handler(service_object);
		await service_start_inner(path, service_object, file_content);
	});
}
const service_start_inner = async (path, service_object, file_content) => {
	try {
		const fun = new Function(
			'require',
			`const log=a=>rtjscomp.log(${
				JSON.stringify(path + ': ')
			}+a);${file_content}`
		);
		fun.call(service_object, custom_require);
	}
	catch (err) {
		log(`error in service ${path}: ${err.message}`);
		await service_stop(service_object, false);
		return;
	}

	if (service_object.start) {
		try {
			await service_object.start();
			service_object.start = null;
			service_object.started = true;
		}
		catch (err) {
			services_active.delete(path);
			log(`error while starting ${path}: ${err.message}`);
			return;
		}
	}
	services_active.set(path, service_object);
	log('service started: ' + path);
}
const services_shutdown = () => (
	log('shutdown services...'),
	Promise.all(
		Array.from(services_active.values())
			.map(service_object => service_stop(service_object, true))
	)
)
const service_stop = async (service_object, forget) => {
	service_object.stopped = true;
	if (forget) fs.unwatchFile(PATH_PUBLIC + service_object.path + '.service.js');
	await service_stop_handler(service_object);
	services_active.delete(service_object.path);
	log('service stopped: ' + service_object.path);
}
const service_stop_handler = async service_object => {
	if (service_object.stop) {
		try {
			await service_object.stop();
			service_object.stop = null;
		}
		catch (err) {
			log(`error while stopping ${service_object.path}: ${err.message}`);
		}
	}
}
global.service_require = path => {
	const service = services_active.get(path);
	if (service) return service;
	throw new Error('service required: ' + path);
}
global.service_require_try = path => (
	services_active.get(path) || null
)

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
		log('file changed: ' + path),
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
		await callback(await fsp.readFile(path, 'utf8'));
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
	spam('log', [msg])
)

const spam_enabled = fs.existsSync('spam.csv');
rtjscomp.spam_history = '';
actions.spam_save = async (muted = false) => {
	if (!spam_enabled) return;

	try {
		fsp.appendFile('spam.csv', rtjscomp.spam_history, 'utf8');
		rtjscomp.spam_history = '';
		muted || log('spam.csv saved');
	}
	catch (err) {
		log('error saving spam.csv: ' + err.message);
	}
}
const spam = (type, data) => {
	if (!spam_enabled) return;

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

	spam('request', [https, request.url, request_ip]);

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
			log(`load ${
				file_dyn_enabled
				?	'dynam'
				:	'stat'
			}ic file: ${path}`);

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
					const file_content_length = file_content.length;

					let code = `async (input,output,request,response,require)=>{const log=a=>rtjscomp.log(${
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
										file_content.substring(
											index_start,
											index_end
										) +
										';'
									);
								}
								else { // `<?=`?
									code += `output.write(''+(${
										file_content.substring(
											++index_start,
											index_end
										)
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
						file_function = eval(code += '}');
					}
					catch (err) {
						throw err.message;
					}
				}
				catch (err) {
					log('compile error: ' + err);
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
					log('request query error: ' + err.message);
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
					log('request body error: ' + err.message);
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

			spam('execute', [
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

			try {
				await file_function(
					file_function_input,
					file_function_output,
					request,
					response,
					custom_require
				);
				file_function_output.end();
			}
			catch (err) {
				if (err instanceof Error) {
					log(`error in file ${path}: ${err.message}`);

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

			spam('static_send', [path, file_gz_enabled]);
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

		if (err >= 400) {
			log(`error ${err} at request: ${request_ip}; ${request.url}`);
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
		actions.http_stop(),
		actions.https_stop && actions.https_stop(),
		services_shutdown(),
	].filter(Boolean));
	await actions.spam_save();
	log('stopped everything');
}
actions.exit = async status => {
	if (exiting) return;
	if (typeof status !== 'number') status = 0;
	await actions.halt();
	log('exiting...');
	exiting = true;
	process.exit(status);
}

process.on('uncaughtException', err => {
	err = err.message || err;
	if (typeof err === 'symbol') err = err.toString();
	log('error uncaughtException: ' + err);
	console.log(err);
	actions.exit(1);
});
process.on('unhandledRejection', err => {
	log('error unhandledRejection: ' + (err.message || err));
	console.log(err);
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
		log('creating config template directory');
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

await Promise.all([
	file_keep_new(PATH_CONFIG + 'init.js', data => {
		if (!data) return;
		log('[deprecated!] run global init script');
		try {
			var require = custom_require;
			eval(data);
		}
		catch (err) {
			log('error in init.js: ' + err.message);
		}
	}),
	file_keep_new(PATH_CONFIG + 'services.txt', async data => {
		log('load service list');
		map_generate_bol(services, data);
		await services_list_react();
	}),
	file_keep_new(PATH_CONFIG + 'file_type_mimes.txt', data => {
		log('load file type map');
		map_generate_equ(file_type_mimes, data);
		if (!file_type_mimes.has('txt')) {
			file_type_mimes.set('txt', 'text/plain; charset=utf-8');
		}
	}),
	file_keep_new(PATH_CONFIG + 'path_aliases.txt', data => {
		log('load path aliases map');
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
		log('load dynamic file type list');
		map_generate_bol(file_type_dyns, data);
	}),
	file_keep_new(PATH_CONFIG + 'file_type_nocompress.txt', data => {
		log('load non-compressable file list');
		map_generate_bol(file_type_nocompress, data);
	}),
	file_keep_new(PATH_CONFIG + 'file_raws.txt', data => {
		if (!data) return;
		log('load static file list');
		map_generate_bol(file_raws, data);
	}),
	file_keep_new(PATH_CONFIG + 'file_privates.txt', data => {
		if (!data) return;
		log('load private file list');
		map_generate_bol(file_privates, data);
	}),
	file_keep_new(PATH_CONFIG + 'file_blocks.txt', data => {
		if (!data) return;
		log('load blocked file list');
		map_generate_bol(file_blocks, data);
	}),
]);

let connections_count = 0;
const server_http = http.createServer(
	(request, response) => request_handle(request, response, false)
);
let http_status = false;
let http_status_target = false;
const http_connections = new Map;

server_http.on('connection', connection => {
	const id = ++connections_count;
	http_connections.set(id, connection);
	connection.on('close', () => {
		http_connections.delete(id);
	});
});

actions.http_start = () => {
	if (http_status) return;
	try {
		server_http.listen(port_http);
		http_status = http_status_target = true;
		log('http started at port ' + port_http);
	}
	catch (err) {
		log('error while starting http: ' + err.message);
	}
}
actions.http_restart = () => {
	if (!http_status) actions.http_start();
	else if (http_status_target) {
		http_status_target = false;
		log('http is restarting...');
		server_http.close(() => {
			http_status = false;
			log('http stopped');
			actions.http_start();
		});
	}
}
actions.http_stop = async () => {
	if (!http_status_target || !http_status) return;
	http_status_target = false;
	log('http is stopping...');
	await new Promise(resolve => server_http.close(resolve));
	http_status = false;
	log('http stopped');
}
actions.http_kill = () => {
	if (http_status_target || !http_status) return;
	log('killing http...');
	for (const connection of http_connections.values()) connection.destroy();
	http_connections.clear();
}

file_keep_new(PATH_CONFIG + 'port_http.txt', data => {
	log('load http port number');
	if (
		!data ||
		isNaN(data = Number(data)) ||
		!number_check_uint(data)
	) {
		log('error: invalid http port number');
	}
	else if (data !== port_http) {
		port_http = data;
		actions.http_restart();
	}
});

try {
	const https_key = fs.readFileSync(PATH_CONFIG + 'ssl/domain.key');
	const https_cert = fs.readFileSync(PATH_CONFIG + 'ssl/chained.pem');
	const server_https = require('https').createServer(
		{key: https_key, cert: https_cert},
		(request, response) => request_handle(request, response, true)
	);

	let https_status = false;
	let https_status_target = false;
	const https_connections = new Map;

	server_https.on('connection', connection => {
		const id = ++connections_count;
		https_connections.set(id, connection);
		connection.on('close', () => {
			https_connections.delete(id);
		});
	});

	actions.https_start = () => {
		if (https_status) return;
		try {
			server_https.listen(port_https);
			https_status = https_status_target = true;
			log('https started at port ' + port_https);
		}
		catch (err) {
			log('error while starting https: ' + err.message);
		}
	}
	actions.https_restart = () => {
		if (!https_status) actions.https_start();
		else if (https_status_target) {
			https_status_target = false;
			log('https is restarting...');
			server_https.close(function () {
				https_status = false;
				log('https stopped');
				actions.https_start();
			});
		}
	}
	actions.https_stop = async () => {
		if (!https_status_target || !https_status) return;
		https_status_target = false;
		log('https is stopping...');
		await new Promise(resolve => server_https.close(resolve));
		https_status = false;
		log('https stopped');
	}
	actions.https_kill = () => {
		if (https_status_target || !https_status) return;
		log('killing https...');
		for (const connection of https_connections.values()) connection.destroy();
		https_connections.clear();
	}

	file_keep_new(PATH_CONFIG + 'port_https.txt', data => {
		log('load https port number');
		if (
			!data ||
			isNaN(data = Number(data)) ||
			!number_check_uint(data)
		) {
			log('error: invalid https port number');
		}
		else if (data !== port_https) {
			port_https = data;
			actions.https_restart();
		}
	});
}
catch (err) {
	log('https is disabled');
}

})();
