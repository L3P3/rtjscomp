#!/usr/bin/env node

"use strict";

(async () => {

const {
	execSync,
} = await import('child_process');
const {
	readFile,
	unlink,
	writeFile,
} = await import('fs/promises');

const GCC_COMMAND = './node_modules/.bin/google-closure-compiler --';

const {version} = require('./package.json', 'utf8');

try {
	if (
		!execSync(GCC_COMMAND + 'version')
			.toString()
			.includes('Version: v202')
	) {
		console.error('newer google closure compiler required!');
		throw null;
	}
}
catch (e) {
	console.error('maybe run: npm install google-closure-compiler');
	process.exit(1);
}

console.log(`build ${version}...`);

let code = (await readFile('rtjscomp.js', 'utf8'))
	.replace(
		"require('./package.json').version",
		JSON.stringify(version)
	)
	.replace(
		'await import(',
		'await import_hiddenfromgcc('
	);

let name_count = 0;
for (const name of 'dependencies_paths file_function handler_stop path_split promise_deps_resolve promise_deps promise_stopped_resolve promise_stopped watcher'.split(' ')) {
	code = code.replaceAll(
		name,
		'x' + (name_count++).toString(36)
	);
}

await writeFile(
	'/tmp/rtjscomp.js',
	code,
	'utf8'
);

execSync(
	GCC_COMMAND +
	[
		'compilation_level SIMPLE',
		'js /tmp/rtjscomp.js',
		'js_output_file /tmp/rtjscomp.min.js',
		'language_in ECMASCRIPT_2017',
		'language_out ECMASCRIPT_2017',
		'module_resolution NODE',
		'rewrite_polyfills false',
		'use_types_for_optimization',
		'warning_level VERBOSE',
		'jscomp_off undefinedVars',
		'jscomp_off missingProperties',
	]
	.join(' --')
);

await writeFile(
	'rtjscomp.js',
	'#!/usr/bin/env node\n"use strict";' + 
	(await readFile('/tmp/rtjscomp.min.js', 'ascii'))
	.replace(
		'await import_hiddenfromgcc(',
		'await import('
	),
	'ascii'
);

await unlink('/tmp/rtjscomp.js');
await unlink('/tmp/rtjscomp.min.js');

console.log('done.');

})();
