"use strict";
var gulp = require("gulp");
var path = require("path");
var gutil = require("gulp-util");
var through = require("through2");
var uglifyOpt = {
	//保留IE的jscript条件注释
	preserveComments: function(o, info) {
		return /@(cc_on|if|else|end|_jscript(_\w+)?)\s/i.test(info.value);
	}
};
// gulp 插件引用开始

// gulp缓存插件，只传递变化了的文件
var cache = require("gulp-cached");
// gulp缓存读取插件，读取缓存中的内容
var remember = require("gulp-remember");
// gulp异常处理插件
var plumber = require("gulp-plumber");

var isDev;

// gulp 插件引用结束

function getFile(callback) {
	var through = require("through2");
	return through.obj(function(file, enc, cb) {
		if (file.isNull()) {
			return cb(null, file);
		}

		if (file.isStream()) {
			this.emit("error", new Error("Streaming not supported"));
			return cb();
		}

		var content;
		try {
			content = callback(file.contents.toString(), file);
		} catch (ex) {
			this.emit("error", ex);
		}
		if (content) {
			file.contents = new Buffer(content);
			this.push(file);
			cb();
		} else {
			cb(null, file);
		}
	});
}

// Stylelint config rules
var stylelintConfig = {
	"rules": {
		"block-no-empty": true,
		"color-no-invalid-hex": true,
		"declaration-colon-space-after": "always",
		"declaration-colon-space-before": "never",
		"function-comma-space-after": "always",
		"function-url-quotes": "double",
		"media-feature-colon-space-after": "always",
		"media-feature-colon-space-before": "never",
		"media-feature-name-no-vendor-prefix": true,
		"max-empty-lines": 5,
		"number-leading-zero": "never",
		"number-no-trailing-zeros": true,
		"property-no-vendor-prefix": true,
		"selector-list-comma-space-before": "never",
		"selector-list-comma-newline-after": "always",
		"selector-no-id": true,
		"string-quotes": "double",
		"value-no-vendor-prefix": true
	}
};
// Stylelint reporter config
var warnIcon = encodeURIComponent(`<svg version="1.1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" x="0px" y="0px" width="48px" height="48px" viewBox="0 0 512 512" enable-background="new 0 0 512 512" xml:space="preserve"><path fill="#A82734" id="warning-4-icon" d="M228.55,134.812h54.9v166.5h-54.9V134.812z M256,385.188c-16.362,0-29.626-13.264-29.626-29.625c0-16.362,13.264-29.627,29.626-29.627c16.361,0,29.625,13.265,29.625,29.627C285.625,371.924,272.361,385.188,256,385.188z M256,90c91.742,0,166,74.245,166,166c0,91.741-74.245,166-166,166c-91.742,0-166-74.245-166-166C90,164.259,164.245,90,256,90z M256,50C142.229,50,50,142.229,50,256s92.229,206,206,206s206-92.229,206-206S369.771,50,256,50z"/></svg>`);
var stylelintReporterConfig = {
	styles: {
		"display": "block",

		"margin": "1em",
		"font-size": ".9em",
		"padding": "1.5em 1em 1.5em 4.5em",
		/* padding + background image padding */

		/* background */
		"color": "white",
		"background-color": "#DF4F5E",
		"background": `url("data:image/svg+xml;charset=utf-8,${ warnIcon }") .5em 1.5em no-repeat, #DF4F5E linear-gradient(#DF4F5E, #CE3741)`,

		/* sugar */
		"border": "1px solid #C64F4B",
		"border-radius": "3px",
		"box-shadow": "inset 0 1px 0 #EB8A93, 0 0 .3em rgba(0,0,0, .5)",

		/* nice font */
		"white-space": "pre-wrap",
		"font-family": "Menlo, Monaco, monospace",
		"text-shadow": "0 1px #A82734"
	}
};
var jsModule = getFile((content, file) => {
	// 模块加载器、非js模块普通文件，cmd规范模块，不作处理
	if (/\/common(?:\Wmin)?\.js$/.test(file.path) || !/\b(?:define\(|module|exports|require\()\b/.test(content) || /\bdefine\.cmd\b/.test(content)) {
		return content;
	}
	var isAmd;
	content = content.replace(/\bdefine\.amd\b/, function() {
		isAmd = true;
		return "define.useamd()";
	});
	if (isAmd || /\bdefine\(\b/.test(content)) {
		return content;
	}
	// CommonJS 规范的 js module.
	var deps = [];

	function addDesp(moduleName) {
		if (!/^(?:common)$/.test(moduleName)) {
			deps.push(JSON.stringify(moduleName));
		}
		return "";
	}

	content.replace(/\/\/[^\r\n]+/g, "").replace(/\/\*.+?\*\//g, "").replace(/\brequire\(\s*(["'])([^"']+)\1\s*\)/g, function(s, quotes, moduleName) {
		// 分析代码中的`require("xxxx")`语句，提取出模块名字
		return addDesp(moduleName);
	}).replace(/\bimport\b[^;]+?\bfrom\s+(["'])([^"']+)\1/g, function(s, quotes, moduleName) {
		// 分析代码中的`import`语句，提取出模块名字
		return addDesp(moduleName);
	});

	if (deps.length) {
		deps = `,[${ deps.join(",") }]`;
	} else {
		deps = "";
	}

	content = content.trim();

	// 对整个js块包裹CMD规范的标准Wrap
	content = `(function(f){typeof define==="function"?define("${ file.path }"${ deps },f):f()})(function(require,exports,module){
${ content }
});`;
	return content;
});

/**
 * 代码错误汇报函数，在浏览器中运行，用于将jshinit收集到的报出的错误信息在浏览器控制台中弹出
 * 注意！！此函数将被toString()后发送到浏览器，并非在node下运行！！
 * @param  {Array} errors 二维数组，里面的维度，[0]是错误消息，[1]是行号，[2]是列号
 * @param  {String} path    文件的路径，可以是js模块路径
 */
function jsBrowserReporter(errors, path) {
	var uri;
	try {
		throw new Error("_");
	} catch (e) {
		try {
			e.stack.replace(/(?:\bat\b|@).*?(\b\w+\:\/{2,}.*?)(?:\:\d+){2,}/, function(m, url) {
				uri = url;
			});
		} catch (ex) {

		}
	}

	// 获取js文件当前路径
	if (uri) {
		// 延迟运行，以免干扰js正常运行流程
		setTimeout(function() {
			// 将文件路径与模块路径拼接为完整的url
			uri = uri.replace(/^((?:\w+\:)?\/{2,}[^\/]+)?.*$/, "$1" + path);
			var unshowMsg = "";
			errors.forEach(window.Error && "fileName" in Error.prototype ? function(err) {
				// 方式一：new Error，对error的属性赋值，然后throw
				var errorObj;
				try {
					errorObj = new SyntaxError(err[0]);
				} catch (ex) {
					errorObj = new Error(err[0]);
				}
				errorObj.columnNumber = err[2];
				errorObj.fileName = uri;
				errorObj.lineNumber = err[1];
				errorObj.message = err[0];
				setTimeout(function() {
					throw errorObj;
				}, 0);

			} : function(err) {
				// 方式二：console.warn方式汇报错误
				err = ("SyntaxError: [0]\n\tat (" + uri + ":[1]:[2])").replace(/\[\s*(\d+)\s*\]/g, function(s, key) {
					return err[+key] || s;
				});

				try {
					// 如果你追踪错误提示来找到这一行，说明你来错误了地方，请按控制台中提示的位置去寻找代码。
					console.error(err);
				} catch (ex) {
					try {
						console.log(err);
					} catch (ex) {
						// 不支持console的浏览器中，记录下消息，稍后alert
						unshowMsg += err + "\n";
					}
				}
			});
			// 不支持console.error的浏览器，用alert弹出错误
			if (unshowMsg) {
				/* global alert */
				alert(unshowMsg);
			}
		}, 200);
	}
}

function jsPipe(stream) {
	var sourcemaps;
	if (isDev) {
		// js 代码风格检查
		var jshint = require("gulp-jshint");

		require("./jshint-msg");
		stream = stream.pipe(jshint());
	} else {
		sourcemaps = require("gulp-sourcemaps");
		stream = stream.pipe(sourcemaps.init())
			// js代码压缩
			.pipe(require("gulp-uglify")(uglifyOpt));
	}
	// 兼容ES6
	// stream = stream.pipe(require("gulp-babel")())

	// 解决压缩js会破坏AngularJS文件所需的依赖注入问题
	// .pipe(require("gulp-ng-annotate")());

	// AMD、CDM模块封装
	stream = stream.pipe(getFile(function(contents, file) {
		if (!/\bdefine\(/i.test(contents) && (/\brequire\(/i.test(contents) || /(?:\bmodule|exports)\s*=[^=]/i.test(contents))) {
			file.moduleWrapLineNumber = 1;
			return `(function(f){typeof define==="function"?define("/${ file.relative.replace(/\\/g, "/") }",f):f()})(function(require,exports,module){${
contents
}});`;
		}
	}));

	if (isDev) {
		// jshint错误汇报
		stream = stream.pipe(getFile(function(js, file) {
			var lineCount = js.replace(/\/\*(?:.|\n)+?\*\//g, "").replace(/\n+/g, "\n").trim().match(/\n/g);
			if (lineCount && lineCount.length > 3 && file.jshint && !file.jshint.success && !file.jshint.ignored && !/[\\/]jquery(?:-\d.*?)?(?:[-\.]min)?.js$/.test(file.path)) {
				var uri = JSON.stringify("/" + file.relative.replace(/\\/g, "/"));
				var errors = JSON.stringify(file.jshint.results.map(result => [result.error.reason, result.error.line + (file.moduleWrapLineNumber || 0), result.error.character]));
				var reporter = jsBrowserReporter.toString().replace(/^(function)\s*\w+/, "$1");
				return `${ js }
(${ reporter })(${ errors }, ${ uri })
`;
			}
		}));
	} else {
		// 输出sourcemaps
		stream = stream.pipe(sourcemaps.write("."));
	}
	return stream;
}

/* CSS代码美化 */
function csscomb(stream) {
	if (isDev) {

		return stream.pipe(getFile(function(css, file) {
			var Comb = require("csscomb");
			var configPath = Comb.getCustomConfigPath(path.join(path.dirname(file.base), ".csscomb.json"));
			var config = Comb.getCustomConfig(configPath);
			var comb = new Comb(config || "csscomb");
			var syntax = file.path.split(".").pop();
			var newCss;

			try {
				newCss = comb.processString(file.contents.toString(), {
					syntax: syntax,
					filename: file.path
				});
			} catch (err) {

			}
			if (newCss && newCss !== css) {
				require("fs").writeFileSync(file.path, newCss);
				return newCss;
			}
		}));
	}
	return stream;
}

function cssPipe(stream) {
	var processors = [
		isDev ? require("stylelint")(stylelintConfig) : null,
		// css未来标准提前使用
		require("postcss-cssnext")({
			features: {
				"autoprefixer": {
					browsers: ["last 3 version", "ie > 8", "Android >= 3", "Safari >= 5.1", "iOS >= 5"]
				}
			}
		}),
		// scss风格的预处理器
		// require("precss")(),
		// IE8期以下兼容rem
		require("pixrem"),
		// IE9兼容vmin
		require("postcss-vmin"),
		// IE8以下兼容合集
		// require("cssgrace"),
		// background: linear-gradient(to bottom, #1e5799, #7db9e8);输出为IE滤镜
		require("postcss-filter-gradient"),
		// 静态资源版本控制
		require("postcss-url")({
			useHash: true,
			url: "copy" // or "inline" or "copy"
		}),
		isDev ? require("postcss-browser-reporter")(stylelintReporterConfig) : null,
		isDev ? require("postcss-reporter")({
			clearMessages: true
		}) : null,
	];

	stream = csscomb(stream);

	// 过滤掉空的postcss插件
	processors = processors.filter(processor => processor);

	stream = stream.pipe(require("gulp-postcss")(processors));

	if (!isDev) {
		// css压缩
		stream = stream.pipe(require("gulp-clean-css")());
	}

	return stream;
}

function htmlPipe(stream) {
	return stream;
}

module.exports = (staticRoot, env) => {

	isDev = env === "development";

	staticRoot = staticRoot || process.cwd();
	var gulpOpts = {
		base: staticRoot
	};

	var sendFileCache = {};

	function sendFile(filePath) {

		var pipeFn;
		filePath = path.resolve(path.join(staticRoot, filePath));

		if (sendFileCache[filePath]) {
			// 如果外部请求的文件正好缓存中有，则发送出去，然后清除缓存中的此文件
			// sourceMap之类情况就是这样，上次请求js时生成的map文件放在缓存中，浏览器下次来取
			return Promise.resolve(sendFileCache[filePath]);
		} else if (/[\.\-]min\.\w+$/.test(filePath)) {
			// 已压缩文件，不作处理
			return;
		} else if (/\.js$/i.test(filePath)) {
			pipeFn = jsPipe;
		} else if (/\.css$/i.test(filePath)) {
			pipeFn = cssPipe;
		} else if (/\.html?$/i.test(filePath)) {
			pipeFn = htmlPipe;
		} else {
			return;
		}

		return new Promise((resolve, reject) => {
			var stream = gulp.src(filePath, gulpOpts)
				// 错误汇报机制
				.pipe(plumber(ex => {
					delete cache.caches[filePath][filePath];
					remember.forget(filePath, filePath);
					reject(ex);
				}))
				// 仅仅传递变化了的文件
				.pipe(cache(filePath));

			// 调用正式的gulp工作流
			stream = pipeFn(stream);

			// 获取缓存中的数据
			stream.pipe(remember(filePath))

			// 取出文件内容，返回给外部
			.pipe(through.obj((file) => {
				file.etag = require("etag")(file.contents);
				// 如果获取到的文件正好是外部要获取的文件，则发送给外部
				if (file.path === filePath) {
					resolve(file);
				} else {
					// 如果获取到的文件是sourceMap之类的文件，先放进缓存，等外部下次请求时发送
					sendFileCache[file.path] = file;
				}
			}));
		});
	}
	return sendFile;
};