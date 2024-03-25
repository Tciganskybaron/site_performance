import fs from 'fs/promises';
import lighthouse from 'lighthouse';
import * as chromeLauncher from 'chrome-launcher';
import ExcelJS from 'exceljs';

// Флог для получения худшего результата
const WORST = false;

(async () => {
	await deletedFile();
	let auditResults = [];

	// Указываем файл с Url 'Test.txt'
	const page = await readUrlsFromFile('Test.txt');
	for (let i = 0; i < page.length; i++) {
		const element = page[i];
		let groupRes = [];
		// Для каждого url запускаем 5 аудитов
		for (let a = 0; a < 5; a++) {
			const auditResElement = await auditPage(element);
			groupRes.push(auditResElement);
		}

		// Итоговый объект для усреднения значений
		let averagedResult = {};
		// Проходимся по каждому полю в объекте
		for (let key in groupRes[0]) {
			if (groupRes[0].hasOwnProperty(key) && key !== 'url') {
				// Исключаем поле 'url'
				// Получаем массив значений для текущего поля
				let fieldValues = groupRes.map(obj => obj[key]);
				// Преобразуем строки в числа, убирая единицы измерения и проверяя на NaN
				fieldValues = fieldValues.map(value => {
					if (typeof value === 'string' && value.includes('s')) {
						return parseFloat(value.replace(' s', '').replace(',', '.')); // Заменяем ',' на '.'
					} else if (typeof value === 'string' && value.includes('ms')) {
						return parseFloat(value.replace(' ms', '').replace(',', '.')); // Заменяем ',' на '.'
					} else {
						return isNaN(parseFloat(value)) ? null : parseFloat(value);
					}
				});
				// Фильтруем null и NaN значения
				fieldValues = fieldValues.filter(value => value !== null && !isNaN(value));
				if (WORST) {
					fieldValues = fieldValues.sort((a, b) => a - b);
					if (['lcp', 'si', 'fcp'].includes(key)) {
						averagedResult[key] = fieldValues.pop().toFixed(1) + ' s';
					} else if (key === 'tbt') {
						averagedResult[key] = fieldValues.pop().toFixed(3) + ' ms';
					} else if (key === 'cls') {
						averagedResult[key] = fieldValues.pop().toFixed(3);
					} else {
						averagedResult[key] = fieldValues.shift().toFixed(1);
					}
				} else {
					// Убираем наибольшее и наименьшее значение
					fieldValues = fieldValues.sort((a, b) => a - b).slice(1, -1);
					// Вычисляем среднее значение
					let averageValue = fieldValues.reduce((acc, val) => acc + val, 0) / fieldValues.length;
					// Преобразуем числовое значение обратно в текст с указанием единицы измерения
					if (['lcp', 'si', 'fcp'].includes(key)) {
						averagedResult[key] = averageValue.toFixed(1) + ' s';
					} else if (key === 'tbt') {
						averagedResult[key] = averageValue.toFixed(3) + ' ms';
					} else if (key === 'cls') {
						averagedResult[key] = averageValue.toFixed(3);
					} else {
						averagedResult[key] = averageValue.toFixed(1);
					}
				}
			} else if (key === 'url') {
				averagedResult[key] = groupRes[0][key]; // Оставляем только первый URL
			}
		}
		auditResults.push(averagedResult);
	}
	await writeAuditResultsToExcel(auditResults);
	console.log('Завершено');
})();

/// Аудит страницы
async function auditPage(page) {
	try {
		const chrome = await chromeLauncher.launch({ chromeFlags: ['--headless'] });
		const options = { logLevel: 'info', output: 'json', port: chrome.port };
		const config = {
			extends: 'lighthouse:default',
			audits: ['autocomplete'],
			categories: {
				// @ts-ignore: `title` is required in CategoryJson. setting to the same value as the default
				// config is awkward - easier to omit the property here. Will defer to default config.
				'best-practices': {
					auditRefs: [{ id: 'autocomplete', weight: 0, group: 'best-practices-ux' }],
				},
			},
		};

		const runnerResult = await lighthouse(page, options, config);

		let audit = {};
		// Записываем результаты аудита
		const lcpAudit = runnerResult.lhr.audits['largest-contentful-paint'];
		audit['lcp'] = lcpAudit.displayValue;
		const tbtAudit = runnerResult.lhr.audits['total-blocking-time'];
		audit['tbt'] = tbtAudit.displayValue;
		const siAudit = runnerResult.lhr.audits['speed-index'];
		audit['si'] = siAudit.displayValue;
		const fcpAudit = runnerResult.lhr.audits['first-contentful-paint'];
		audit['fcp'] = fcpAudit.displayValue;
		const clsAudit = runnerResult.lhr.audits['cumulative-layout-shift'];
		audit['cls'] = clsAudit.displayValue;
		const performance = Math.round(runnerResult.lhr.categories.performance.score * 100);
		audit['per'] = performance;
		const accessibility = Math.round(runnerResult.lhr.categories.accessibility.score * 100);
		audit['acc'] = accessibility;
		const bestPractices = Math.round(runnerResult.lhr.categories['best-practices'].score * 100);
		audit['best'] = bestPractices;
		const ceo = Math.round(runnerResult.lhr.categories.seo.score * 100);
		audit['ceo'] = ceo;
		const url = runnerResult.lhr.finalDisplayedUrl;
		audit['url'] = url;

		// Закрываем браузер
		await chrome.kill();
		return audit;
	} catch (err) {
		console.error('Ошибка работы Lighthouse:', err);
	}
}
// Чтение файла с url
async function readUrlsFromFile(file) {
	try {
		const data = await fs.readFile(file, 'utf8');
		const urlsArray = data.split('\n').filter(Boolean);
		return urlsArray;
	} catch (err) {
		console.error('Ошибка при чтении файла:', err);
	}
}

// Записываем резельтыты в audit_results.xlsx
async function writeAuditResultsToExcel(auditResults) {
	const workbook = new ExcelJS.Workbook();
	const worksheet = workbook.addWorksheet('Audit Results');
	// Заголовки для таблицы
	worksheet.addRow(['URL', 'LCP', 'TBT', 'SI', 'FCP', 'CLS', 'Performance', 'Accessibility', 'Best Practices', 'SEO']);

	// Записываем результаты аудита
	auditResults.forEach(audit => {
		worksheet.addRow([audit.url, audit.lcp, audit.tbt, audit.si, audit.fcp, audit.cls, audit.per, audit.acc, audit.best, audit.ceo]);
	});

	// Сохраняем файл Excel
	const excelFileName = 'audit_results.xlsx';
	await workbook.xlsx.writeFile(excelFileName);
	console.log(`Результаты аудита сохранены в файле ${excelFileName}`);
}

// Удаляем файл в начале Аудита если он есть
async function deletedFile() {
	try {
		// Попробуйте доступ к файлу audit_results.xlsx
		await fs.access('audit_results.xlsx');
		// Если доступ к файлу удалось, удаляем его
		await fs.unlink('audit_results.xlsx');
		console.log('Удален файл audit_results.xlsx');
	} catch (err) {
		console.log('Файла audit_results.xlsx не существует');
	}
}
