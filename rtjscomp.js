//RTJSCOMP von L3P3, 2017-2024
"use strict";
const version='0.6.0';

// FESTE PARAMETER //
const path_public='public/';
const path_config='config/';
const path_data='data/';
const gzip_options={
	level:9
};

// PARAMETER //
//Hostnamen
var hostnames;
//HTTP-Port
var port_http;
//HTTPS-Port
var port_https;
//Maximale Größe von statischen Dateien, um zwischengespeichert zu werden
var cache_raw_size_max;
//Dateitypen
var file_type_mimes;
//Dateitypen, die interpretiert werden sollen
var file_type_dyns;
//Dateitypen, die nicht komprimiert werden sollen
var file_type_nocompress;
//Dateien, die nicht interpretiert werden sollen
var file_raws;
//Dateien, die sich nicht aufrufen lassen sollen
var file_privates;
//Dateien, bei denen garnicht geantwortet wird
var file_blocks;
//Pfade, die auf andere Dateien zeigen
var path_aliases;
//Dienste, die automatisch gestartet werden sollen
var services;
//Überprüfen, ob Besucher ein Bot ist
var agent_check_bot=/bot/i;
//Überprüfen, ob Besucher mobil ist
var agent_check_mobil=/mobile/i;

// MODULE //
const url=require('url');
const fs=require('fs');
const multipart_parse=require('parse-multipart-data').parse;
const zlib=require('zlib');
const request_ip_get=require('ipware')().get_ip;
const querystring_parse=require('querystring').decode;

// REGULARE //
//Listenzeichen HTTP
const reg_comma=/,\s*/;

// ZWISCHENSPEICHER //
//Dateifunktionen
const file_cache_functions={};

//Datei-übergreifende Variablen
const globals={
	rtjs:{
		version:version,
		port_http:port_http,
		port_https:port_https
	}
};
//Aktionen
const actions={};

if(!Object.fromEntries)Object.fromEntries=entries=>{
	const object={};
	for(const entry of entries)object[entry[0]]=entry[1];
	return object;
};

// DATEN //
function data_save(name,data){
	log('Speichern: '+name);
	fs.writeFileSync(
		path_data+name,
		data,
		'utf8'
	);
}

function data_load(name){
	log('Laden: '+name);
	if(!fs.existsSync(path_data+name))
		return null;

	return fs.readFileSync(
		path_data+name,
		'utf8'
	);
}

function data_load_watch(name,callback){
	file_keep_new(
		path_data+name,
		false,
		function(exists){
			log('Laden: '+name);

			if(exists)
				callback(
					fs.readFileSync(
						path_data+name,
						'utf8'
					)
				);
			else
				callback(null);
		}
	);
}

// DIENSTE //
const services_active={};
function services_init(){
	for(var path in services_active){
		if(path in services)continue;
		service_stop(path);
	}
	for(var path in services){
		if(path in services_active)continue;
		service_start(path);
	}
}
function services_shutdown(){
	log('Dienste werden beendet...');
	for(var path in services_active){
		service_stop(path);
	}
}
function service_start(path){
	//Dienst-Objekt
	const service_object=services_active[path]={};
	//Dienst wurde schon gestartet?
	service_object.started=false;

	file_keep_new(path_public+path+'.service.js',true,function(file_content){
		if('stop' in service_object){
			try{
				service_object.stop(false);
			}
			catch(e){
				log('Fehler beim stoppen von Dienst: '+path+', '+e.message);
				return;
			}
		}
		service_run(file_content,service_object,path);
	});
}
function service_run(file_content,service_object,path){
	//Datei nicht mehr vorhanden?
	if(file_content!==null){}else{
		log('Dienstdatei existiert nicht: '+path);
		if(service_object.started)service_stop(path);
		return;
	}
	//Dateiinhalt ausführen
	try{
		eval('(function(globals,actions){const log=function(a){log_o("'+string_codify(path)+': "+a)};'+file_content+'})').call(service_object,globals,actions);
	}
	catch(e){
		log('Dienstdatei fehlerhaft: '+path+', '+e.message);
		return;
	}

	//Start-Funktion vorhanden?
	if('start' in service_object){
		try{
			service_object.start(!service_object.started);
		}
		catch(e){
			delete services_active[path];
			log('Fehler beim starten von Dienst: '+path+', '+e.message);
			return;
		}
	}
	service_object.started=true;
	log('Dienst gestartet: '+path);
}
function service_stop(path){
	fs.unwatchFile(path_public+path+'.service.js');
	const service_object=services_active[path];
	if('stop' in service_object){
		try{
			service_object.stop(true);
		}
		catch(e){
			log('Fehler beim stoppen von Dienst: '+path+', '+e.message);
			return;
		}
	}
	delete services_active[path];
	log('Dienst beendet: '+path);
}
function service_check(path){
	return (path in services_active);
}
function service_require(path){
	if(service_check(path))return services_active[path];
	log('Dienst benötigt: '+path);
	throw 503;
}
function service_require_try(path){
	if(service_check(path))return services_active[path];
	return null;
}

// EINSTELLUNGSDATEIEN //
//Objekt aus Liste
function map_generate_bol(data){
	if(!data)return {};
	const result={};
	data.split('\n').forEach(function(itm){
		if(
			(itm.length>0)&&
			(itm.charAt(0)!=='#')
		)
			result[itm]=undefined;
	});
	return result;
}
function map_generate_equ(data){
	if(!data)return {};
	const result={};
	data.split('\n').forEach(function(itm){
		if(
			(itm.length>0)&&
			(itm.charAt(0)!=='#')
		){
			const equ=itm.split(':');
			result[equ[0]]=equ[1]||'';
		}
	});
	return result;
}
function bol_generate_map(object){
	const result=[];
	for(var i in object)result.push(i);
	return result.join('\n');
}

// TEXT IN CODE //
function string_codify(string){
	return(
		string
		.replace(/\\/g,"\\\\")
		.replace(/\n/g,"\\n")
		.replace(/\t/g,"\\t")
		.replace(/\'/g,"\\'")
	);
}

// ZAHLEN PRÜFEN //
function number_check_int(number){
	return Math.floor(number)===number;
}
function number_check_uint(number){
	return (number>=0)&&number_check_int(number);
}

// DATEIEN ÜBERWACHEN //
//Prüfen, ob Datei geändert wurde
function file_compare(curr,prev,path){
	if(curr.mtime>prev.mtime){
		log('Datei wurde geändert: '+path);
		return true;
	}
	return false;
}

//Warten, bis Datei verändert wurde
function file_watch(path,callback){
	fs.watchFile(
		path,
		function(curr,prev){
			if(
				file_compare(curr,prev,path)
			){
				fs.unwatchFile(path);
				callback();
			}
		}
	);
}

function file_at_change(curr,prev,path,callback){
	if(fs.existsSync(path)){
		if(
			file_compare(curr,prev,path)
		)
			callback(true);
	}
	else
		callback(false);
}

//Datei aktuell halten
function file_keep_new(path,readutf8,callback){
	if(readutf8){
		const callback_alt=callback;
		callback=function(exists){
			if(exists)callback_alt(fs.readFileSync(path,'utf8'));
			else callback_alt(null);
		}
	}

	if(fs.existsSync(path)){
		callback(true);
		fs.watchFile(
			path,
			function(curr,prev){
				file_at_change(curr,prev,path,callback);
			}
		);
	}
	else
		callback(false);
}

// PROTOKOLL //
var log_history=[];

actions.log_clear=function(){
	log_history=[];
}

//Ereignis notieren
function log(msg){
	console.log(msg);
	log_history.push(msg);
	spam('log',[msg]);
}
var log_o=log;

// ANALYSEDATEN //
var spam_history='';

actions.spam_save=function(q){
	var spam_history_copy=spam_history;
	spam_history='';

	q || log('Analysedaten speichern...');

	try{
		fs.appendFileSync(
			'spam.csv',
			spam_history_copy,
			'utf8'
		);
	}
	catch(e){
		log('Fehler beim Speichern von Analysedaten: '+e.message);
	}
}

function spam(type,data){
	spam_history+=(
		Date.now()+
		','+
		type+
		','+
		JSON.stringify(data)+
		'\n'
	);

	if(spam_history.length<1e6){}else
		actions.spam_save();
}

// ANFRAGENVERARBEITUNG //
async function onRequest(request,response,https){
	https = request.headers['x-forwarded-proto'] === 'https' || https;
	spam('request',[https,request.url]);
	try{
		//URL interpretieren
		const request_url_parsed=url.parse(request.url,false);
		//Hostname
		var hostname=request_url_parsed.hostname;
		//Sicherstellen, dass der richtige Hostname angegeben wurde
		hostname_check:{
			if(
				!hostname||
				hostname in hostnames
			)
				break hostname_check;

			throw(421);
		}
		//Angeforderter Pfad
		var path=request_url_parsed.pathname||'index.html';
		//Hack-Filter
		if(path.includes('php')||path.includes('sql'))return;
		//Pfad säubern
		path_clean:{
			var path_length=path.length;
			//Vorrangehende Schrägstriche entfernen
			do{
				if(path.charCodeAt(0)!==47)break;
				path=path.substr(1);
			}
			while(--path_length>0);

			//Folgende Schrägstriche entfernen
			while(path_length>0){
				if(path.charCodeAt(--path_length)!==47)break;
				path=path.substr(0,path_length);
			}

			//Keine verbotenen Zeichen enthalten?
			if(
				(path.lastIndexOf('..')<0)&&
				(path.lastIndexOf('~')<0)
			)
				break path_clean;

			throw(403);
		}
		//Sicherstellen, dass Pfad nicht blockiert ist
		if(path in file_blocks)return;
		//Decknamen auflösen
		if(path in path_aliases){
			path=path_aliases[path];
			response.setHeader('Content-Location',path);
		}

		//Inhalt lesen
		let request_body_promise=null;
		if(request.method!=='GET'&&request.headers['content-length']){
			request_body_promise=new Promise(resolve=>{
				const request_body_chunks=[];
				request.on('data',chunk=>{
					request_body_chunks.push(chunk);
				});
				request.on('end',chunk=>{
					chunk&&request_body_chunks.push(chunk);
					resolve(Buffer.concat(request_body_chunks));
				});
			});
		}

		//Dateityp ermitteln
		const file_type=(
			(
				path.lastIndexOf('.')>path.lastIndexOf('/')
			)?(
				path.substr(path.lastIndexOf('.')+1).toLowerCase()
			):(
				''
			)
		);

		//Soll Datei komprimiert werden?
		var file_gz_enabled=true;

		//Ist dies eine rohe Datei?
		const file_dyn_enabled=(
			(file_type in file_type_dyns)&&
			!(path in file_raws)
		);

		//Dynamische Datei?
		if(file_dyn_enabled){
			//Dateifunktion
			var file_function;
		}
		//Statische Datei?
		else{
			//Dateiinhalt
			var file_data=null;
			//Dateiinhaltslänge
			var file_data_length;

			if(file_type in file_type_nocompress)
				file_gz_enabled=false;

			//Zwischengespeicherte Kompression
			var file_data_gz;
		}

		//Angeben
		response.setHeader('Server','l3p3 rtjscomp v'+version);
		//CORS
		response.setHeader('Access-Control-Allow-Origin','*');
		//IP-Adresse ermitteln
		var request_ip=request_ip_get(request).clientIp;
		//Tatsächlicher relativer Dateipfad
		const path_real=path_public+path;

		//Sicherstellen, dass Datei-Inhalt geladen ist
		file_load:{
			//Bereits zwischengespeichert?
			if(file_dyn_enabled){
				if(path in file_cache_functions){
					file_function=file_cache_functions[path];
					break file_load;
				}
			}
			//Noch nicht zwischengespeichert
			log('Lade Datei: '+path);
			//Darf auf Datei nicht zugegriffen werden?
			if(
				//Nicht in expliziter Liste?
				!(path in file_privates)&&
				//Keine Initialisierungsdatei?
				(path.substr(path.length-8)!=='.init.js')&&
				//Keine Dienstdatei?
				(path.substr(path.length-11)!=='.service.js')
			){}else
				throw(403);
			//Datei existiert nicht?
			if(
				fs.existsSync(path_real)
			){}else
				throw(404);
			//Dateieigenschaften
			const file_stat=fs.statSync(path_real);
			//Datei ist ein Verzeichnis?
			if(
				!file_stat.isDirectory()
			){}else
				throw(403);

			//Falls dynamisch
			if(file_dyn_enabled){
				//Datei laden
				const file_content=fs.readFileSync(path_real,{
					'encoding':'utf8'
				});
				log('Interpretiere Datei: '+path);
				try{
					//Hat sich ein Windows-Zeilenumbruch eingeschlichen?
					if(file_content.lastIndexOf('\r')<0){}else
						throw('Unerlaubtes \\r');
					//Gesamtlänge der Datei
					const file_content_length=file_content.length;
					//Generierter JavaScript-Code
					var code='(async function(input,output,globals,request,response){const log=function(a){log_o("'+string_codify(path)+': "+a)};';
					//Aktueller Bereich dynamisch?
					var section_dynamic=false;
					//Anfang des Bereichs
					var index_start;
					//Ende des Bereichs
					var index_end=0;

					//Wiederholen, bis am Ende angekommen
					while(index_end<file_content_length){
						//Da weitermachen, wo vorher aufgehört wurde
						index_start=index_end;
						//Dynamischer Bereich?
						if(section_dynamic){
							//"<?" überspringen
							index_start+=2;
							//Kein weiteres "?>"?
							if(
								(
									index_end=file_content.indexOf('?>',index_start)
								)>-1
							){}else
								throw('"?>" fehlt am Ende');
							//Als nächstes kommt statischer Text
							section_dynamic=false;
							//Bereich nicht leer?
							if(index_start<index_end){
								//"<?"?
								if(file_content.charCodeAt(index_start)!==61)
									code+=(
										file_content.substring(
											index_start,
											index_end
										)+
										';'
									);
								//"<?="?
								else
									code+=(
										'output.write(""+('+
										file_content.substring(
											++index_start,
											index_end
										)+
										'));'
									);
							}
							//"?>" überspringen
							index_end+=2;
						}
						//Statischer Bereich?
						else{
							//Kommt danach noch etwas?
							if(
								(
									index_end=file_content.indexOf('<?',index_start)
								)>-1
							)
								//Als nächstes kommt dynamischer Text
								section_dynamic=true;
							//Kein dynamischer Bereich mehr dahinter?
							else
								//Bereich geht bis zum Ende
								index_end=file_content_length;

							//Bereich ist nicht leer?
							if(index_start<index_end)
								//Bereich in String-Format bringen und hinzufügen
								code+=("output.write('"+(
									file_content
									.substring(index_start,index_end)
									.replace(/\\/g,"\\\\")
									.replace(/\n/g,"\\n")
									.replace(/\t/g,"\\t")
									.replace(/\'/g,"\\'")
								)+"');");
						}
					}

					code+="})";

					try{
						file_function=eval(code);
					}
					catch(e){
						throw e.message;
					}
				}
				catch(e){
					log('Fehler beim Interpretieren: '+e);
					throw 500;
				}
				//Zwischenspeichern
				file_cache_functions[path]=file_function;
				//Auf Veränderungen überwachen
				file_watch(path_real,function(){
					delete file_cache_functions[path];
				});
			}
			//Falls statisch
			else{
				//Dateigröße ermitteln
				file_data_length=file_stat.size;
				//Ist Datei klein genug zum Zwischenspeichern?
				if(
					file_data_length<=cache_raw_size_max
				){
					//Datei laden und zwischenspeichern
					file_data=fs.createReadStream(path_real);

					//Datei groß genug, um noch komprimiert werden zu können?
					if(
						file_data_length>90
					){
						//Pfad zu der komprimierten Datei
						const path_real_gz=path_real+'.gz';
						//Liegt die Datei schon komprimiert vor?
						if(fs.existsSync(path_real_gz)){
							//Komprimierte Daten laden
							file_data_gz=fs.createReadStream(path_real_gz);
						}
						//Dateityp nicht komprimieren?
						else
							//Nicht mehr komprimieren
							file_gz_enabled=false;
					}
					//Datei zu klein?
					else
						//Nicht mehr komprimieren
						file_gz_enabled=false;
				}
			}
		}

		//Status setzen
		response.statusCode=200;
		//Dateityp setzen
		response.setHeader(
			'Content-Type',
			file_type_mimes[
				(file_type in file_type_mimes)?file_type:'txt'
			]
		);
		//Anfragekopf zwischenspeichern
		const request_headers=request.headers;
		//Soll noch komprimiert werden?
		if(file_gz_enabled){
			check_gz:{
				//Unterstützt der Besucher überhaupt Komprimierung?
				if(
					('accept-encoding' in request_headers)&&
					(request_headers['accept-encoding'].split(reg_comma).lastIndexOf('gzip')>-1)
				)
					break check_gz;

				file_gz_enabled=false;
			}
		}

		//Falls dynamisch
		if(file_dyn_enabled){
			//Eingangsdaten sammeln
			//Parameter für Seitenprogramm
			const file_function_input={};
			{
				//Kekse auslesen
				cookie_read:{
					//Keksdaten
					const cookie_raw=request_headers['cookie'];
					//Keine Keksdaten?
					if(!cookie_raw)break cookie_read;
					//Keksdaten interpretieren
					cookie_raw.split(';').forEach(function(cookie){
						//Äußere Leerzeichen entfernen
						cookie=cookie.trim();
						//Position des Gleichheitszeichens
						const index_equ=cookie.indexOf('=');
						//Sind Zeichen vor dem Gleichheitszeichen?
						if(index_equ>0){
							file_function_input[
								cookie
								.substring(0,index_equ)
								.trimRight()
							]=(
								decodeURI(
									cookie
									.substr(index_equ+1)
									.trimLeft()
								)
							);
						}
						//Gibt es kein Gleichheitszeichen?
						else if(index_equ<0){
							file_function_input[cookie]=undefined;
						}
					});
				}
				//X-Input
				xinput_read:{
					const xinput=request_headers['x-input'];
					if(!xinput)break xinput_read;
					Object.assign(file_function_input,querystring_parse(xinput));
				}
				//?-Parameter
				query_read:{
					//Parameter
					const query=request_url_parsed.query;
					//Keine Parameter?
					if(!query)break query_read;
					//Parameter interpretieren
					try{
						Object.assign(file_function_input,querystring_parse(query));
					}
					catch(e){
						throw 400;
					}
				}
				//POST-Parameter
				if(request_body_promise!==null){
					try{
						const content_type=request.headers['content-type']||'';
						const body_raw=file_function_input['body']=await request_body_promise;
						let body=null;
						switch(content_type.split(';')[0]){
							case 'application/x-www-form-urlencoded':
								body=querystring_parse(body_raw.toString());
								break;
							case 'application/json':
								body=JSON.parse(body_raw.toString());
								break;
							case 'multipart/form-data': {
								body=Object.fromEntries(
									multipart_parse(
										body_raw,
										content_type.split('boundary=')[1].split(';')[0]
									)
									.map(({name,...value})=>[
										name,
										value.type?value:value.data.toString()
									])
								);
							}
						}
						body&&Object.assign(file_function_input,body);
					}
					catch(e){
						log('request body error: '+e.message);
						throw 400;
					}
				}
				//Besucher-Art
				{
					const request_headers_user_agent=file_function_input['user_agent']=request_headers['user-agent'];
					file_function_input['bot']=agent_check_bot.test(request_headers_user_agent);
					file_function_input['mobil']=agent_check_mobil.test(request_headers_user_agent);
				}
				//Mapping
				file_function_input['https']=https;
				file_function_input['ip']=request_ip;
				file_function_input['method']=request.method.toLowerCase();
			}
			//Rückgabedaten
			var file_function_output;
			//Dynamische Daten; nicht zwischenspeichern!
			response.setHeader('Cache-Control','no-cache, no-store');

			//Komprimiert senden?
			if(file_gz_enabled){
				response.setHeader('Content-Encoding','gzip');

				//Komprimierte Daten senden
				(
					//Programmausgabe=Kompressor
					file_function_output=zlib.createGzip(gzip_options)
				).pipe(response);
			}
			//Unkomprimiert senden?
			else{
				file_function_output=response;
			}

			spam('execute',[
				path,
				Object.fromEntries(
					Object.entries(file_function_input)
					.filter(e=>e[0]!=='body')
					.map(e=>e[0]==='password'?[e[0],'***']:e)
					.map(e=>e[0]==='file'?[e[0],'...']:e)
					.map(e=>(typeof e[1]==='object'&&!e[1].length)?[e[0],Object.keys(e[1])]:e)
					.map(e=>(e[0]!=='user_agent'&&typeof e[1]==='string'&&e[1].length>20)?[e[0],e[1].substr(0,20)+'...']:e)
				)
			]);

			//Seitenprogramm ausführen
			try{
				await file_function(
					file_function_input,
					file_function_output,
					globals,
					request,
					response
				)
				file_function_output.end();
			}
			catch(e){
				//Ist das ein vor-Versand-Fehler?
				if(typeof(e)==='number'){
					response.removeHeader('Content-Encoding');
					throw(e);
				}
				log('Fehler beim Ausführen: '+path+', '+e.message);
				file_function_output.end(((file_type==='html')?'<hr>':'\n\n---\n')+'Interner Fehler!');
			}
		}
		//Falls statisch
		else{
			spam('static_send',[path,file_gz_enabled]);
			//Ausschnitt
			//Rohe Dateien können in Teilen übertragen werden
			//response.setHeader('Accept-Ranges','bytes');
			response.setHeader('Cache-Control', 'public, max-age=600');
			//Ausschnitt für diese Anfrage aktiviert?
			var file_range_enabled=false;
			//Ausschnitt ermitteln
			file_range:{
				break file_range;//TODO unfertig
				//Kein Auschnitt angegeben?
				if(!('range' in request_headers))
					break file_range;
				//Nur ein Ausschnitt zur Zeit
				const request_headers_range=request_headers['range'].split(',')[0];

				//Ungültiges Format?
				if(request_headers_range.lastIndexOf('bytes ')>-1){}else
					throw(416);

				//Die beiden Werte, von "-" getrennt
				const request_headers_range_values=request_headers_range.substr(6).split('-');
				//Start
				const file_range_start=Number(request_headers_range_values[0].trim());
				//Start ungültig?
				if(
					!isNaN(file_range_start)&&
					number_check_uint(file_range_start)&&
					(file_range_start<file_data_length)
				){}else
					throw(416);
				//Ende
				const file_range_end_raw=request_headers_range_values[1].trim();
				var file_range_end;
				//Ende angegeben?
				if(file_range_end_raw.length>0){
					file_range_end=Number(file_range_end_raw);
					//Ende ungültig?
					if(
						!isNaN(file_range_end)&&
						number_check_uint(file_range_end)&&
						(file_range_start<file_range_end)&&
						(file_range_end<file_data_length)
					){}else
						throw(416);
				}
				//Kein Ende angegeben?
				else{
					file_range_end=file_data_length-1;
				}

				//Status in Kopf setzen
				response.statusCode=206;
				file_range_enabled=true;
			}

			//Ist Datei zwischengespeichert?
			if(file_data!==null){
				//Komprimiert senden?
				if(file_gz_enabled){
					response.setHeader('Content-Encoding','gzip');
					file_data_gz.pipe(response);
				}
				//Unkomprimiert senden?
				else{
					file_data.pipe(response);
				}
			}
			//Ist Datei zu groß?
			else{
				//Nur Ausschnitt senden?
				if(file_range_enabled){
					fs.createReadStream(
						path_real,
						{
							start:file_range_start,
							end:file_range_end
						}
					).pipe(response);
				}
				//Alles senden?
				else{
					//Datei direkt senden
					fs.createReadStream(path_real).pipe(response);
				}
			}
		}
	}
	catch(e){
		//Falls ich Scheiße gebaut habe
		if(typeof(e)==='number'){}else{
			log(e.message);
			e=500;
		}
		//Fehlerbeschreibung
		var msg;
		//Beschreibung ermitteln
		switch(e){
			case 400:
				msg='Ungültige Anfrage';
				break;
			case 403:
				msg='Datei ist privat';
				break;
			case 404:
				msg='Datei nicht gefunden';
				break;
			case 416:
				msg='Ung&uuml;ltiger Bereich';
				break;
			case 421:
				msg='Ung&uuml;ltiger Hostname';
				break;
			case 422:
				msg='Ung&uuml;ltige Anfragedetails';
				break;
			case 500:
				msg='Interner Fehler';
				break;
			case 503:
				msg='Dienst inaktiv';
				break;
		}
		//Meldung senden
		response.writeHead(e,{
			'Content-Type':'text/html',
			'Cache-Control':'no-cache, no-store'
		});
		response.end('<!DOCTYPE html><html><body><h1>HTTP '+e+(msg!==undefined?': '+msg:'')+'</h1></body></html>');
		//Meldung ausgeben
		if(e>399){
			log('Fehler '+e+': '+request_ip+'; '+request.url);
		}
	}
}

//Hochzähler
var connections_count=0;

//HTTP
const server_http=require('http').createServer(function(request,response){
	onRequest(request,response,false);
});
var http_aktiv=false;
var http_aktiv_soll=false;
var http_connections={};

server_http.on('connection',function(connection) {
	const id=++connections_count;
	http_connections[id]=connection;
	connection.on('close',function(){
		delete http_connections[id];
	});
});

actions.http_start=function(){
	if(http_aktiv)return;
	try{
		server_http.listen(port_http);
		http_aktiv=http_aktiv_soll=true;
		log('HTTP gestartet an Port '+port_http);
	}
	catch(err){
		log('Konnte HTTP nicht starten');
	}
}
actions.http_restart=function(){
	if(!http_aktiv)actions.http_start();
	else if(http_aktiv_soll){
		http_aktiv_soll=false;
		log('HTTP wird neu gestartet...');
		server_http.close(function(){
			http_aktiv=false;
			log('HTTP beendet');
			actions.http_start();
		});
	}
}
actions.http_stop=function(){
	if(!http_aktiv_soll||!http_aktiv)return;
	http_aktiv_soll=false;
	log('HTTP wird beendet...');
	server_http.close(function(){
		http_aktiv=false;
		log('HTTP beendet');
	});
}
actions.http_kill=function(){
	if(http_aktiv_soll||!http_aktiv)return;
	log('HTTP wird getötet...');
	for(var id in http_connections)http_connections[id].destroy();
	http_connections={};
};

//HTTPS
var https_disabled=true;
try{
	const https_key=fs.readFileSync(path_config+'ssl/domain.key');
	const https_cert=fs.readFileSync(path_config+'ssl/chained.pem');
	const server_https=require('https').createServer({key:https_key,cert:https_cert},function(request,response){
		onRequest(request,response,true);
	});

	https_disabled=false;

	var https_aktiv=false;
	var https_aktiv_soll=false;
	var https_connections={};

	server_https.on('connection',function(connection) {
		const id=++connections_count;
		https_connections[id]=connection;
		connection.on('close',function(){
			delete https_connections[id];
		});
	});

	actions.https_start=function(){
		if(https_aktiv)return;
		try{
			server_https.listen(port_https);
			https_aktiv=https_aktiv_soll=true;
			log('HTTPS gestartet an Port '+port_https);
		}
		catch(err){
			log('Konnte HTTPS nicht starten');
		}
	}
	actions.https_restart=function(){
		if(!https_aktiv)actions.https_start();
		else if(https_aktiv_soll){
			https_aktiv_soll=false;
			log('HTTPS wird neu gestartet...');
			server_https.close(function(){
				https_aktiv=false;
				log('HTTPS beendet');
				actions.https_start();
			});
		}
	}
	actions.https_stop=function(){
		if(!https_aktiv_soll||!https_aktiv)return;
		https_aktiv_soll=false;
		log('HTTPS wird beendet...');
		server_https.close(function(){
			https_aktiv=false;
			log('HTTPS beendet');
		});
	}
	actions.https_kill=function(){
		if(https_aktiv_soll||!https_aktiv)return;
		log('HTTPS wird getötet...');
		for(var id in https_connections)https_connections[id].destroy();
		https_connections={};
	}
}
catch(e){
	log('HTTPS deaktiviert!');
}

actions.shutdown=function(){
	services_shutdown();
	actions.http_stop();
	actions.https_stop&&actions.https_stop();
	actions.spam_save();
	log('Angehalten');
}
actions.restart=function(){
	actions.shutdown();
	log('Beenden...');
	process.exit();
}

process.on('uncaughtException',function(err) {
	log('uncaughtException: '+(err.message||err));
	console.log(err);
	actions.restart();
});
process.on('unhandledRejection',function(err) {
	log('unhandledRejection: '+(err.message||err));
	console.log(err);
	actions.restart();
});
process.on('exit',actions.restart);
process.on('SIGINT',actions.restart);
//process.on('SIGUSR1',actions.restart);
process.on('SIGUSR2',actions.restart);
process.on('SIGTERM',actions.restart);

log('rtjscomp '+version+' gestartet');

//Globale Initialisierung
file_keep_new(path_config+'init.js',true,function(data){
	if(data===null)return;
	log('Globale Initialisierung ausführen...');
	try{
		eval(data);
	}
	catch(err){
		log('Fehler in globaler Initialisierung: '+(err.message||err));
	}
});

// KONFIGURATION //
file_keep_new(path_config+'hostnames.txt',true,function(data){
	log('Liste an Hostnamen laden...');
	hostnames=map_generate_bol(data);
});
file_keep_new(path_config+'file_type_mimes.txt',true,function(data){
	log('Liste an Dateitypen laden...');
	file_type_mimes=map_generate_equ(data);
	if(!('txt' in file_type_mimes))file_type_mimes['txt']='text/plain; charset=utf-8';
});
file_keep_new(path_config+'path_aliases.txt',true,function(data){
	log('Liste an Pfadumleitungen laden...');
	path_aliases=map_generate_equ(data);
});
file_keep_new(path_config+'file_type_dyns.txt',true,function(data){
	log('Liste an rohen Dateitypen laden...');
	file_type_dyns=map_generate_bol(data);
});
file_keep_new(path_config+'file_type_nocompress.txt',true,function(data){
	log('Liste an nicht zu komprimierenden Dateitypen laden...');
	file_type_nocompress=map_generate_bol(data);
});
file_keep_new(path_config+'file_raws.txt',true,function(data){
	log('Liste an rohen Dateien laden...');
	file_raws=map_generate_bol(data);
});
file_keep_new(path_config+'file_privates.txt',true,function(data){
	log('Liste an privaten Dateien laden...');
	file_privates=map_generate_bol(data);
});
file_keep_new(path_config+'file_blocks.txt',true,function(data){
	log('Liste an blockierten Pfaden laden...');
	file_blocks=map_generate_bol(data);
});
file_keep_new(path_config+'cache_raw_size_max.txt',true,function(data){
	log('Maximale Dateigröße zum Zwischenspeichern laden...');
	if(
		data===null||
		isNaN(data=Number(data))||
		!number_check_uint(data)
	)
		log('Ungültige Dateigröße');
	else{
		cache_raw_size_max=data;
	}
});

file_keep_new(path_config+'services.txt',true,function(data){
	log('Liste an Diensten laden...');
	services=map_generate_bol(data);
	services_init();
});

file_keep_new(path_config+'port_http.txt',true,function(data){
	log('HTTP-Portnummer laden...');
	if(
		data===null||
		isNaN(data=Number(data))||
		!number_check_uint(data)
	)
		log('Ungültige Portnummer für HTTP');
	else{
		if(data===port_http)return;
		port_http=data;

		actions.http_restart();
	}
});
if(!https_disabled)file_keep_new(path_config+'port_https.txt',true,function(data){
	log('HTTPS-Portnummer laden...');
	if(
		data===null||
		isNaN(data=Number(data))||
		!number_check_uint(data)
	)
		log('Ungültige Portnummer für HTTPS');
	else{
		if(data===port_https)return;
		port_https=data;

		actions.https_restart();
	}
});
