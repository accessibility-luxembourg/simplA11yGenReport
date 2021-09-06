const parse = require('csv-parse/lib/sync')
const fs = require('fs')
const pdfCheck = parse(fs.readFileSync('./data/pdfCheck-03092021.csv'), {
    columns: true,
    skip_empty_lines: true
  })
  const distrib = parse(fs.readFileSync('./data/distrib-03092021.csv'), {
    columns: true,
    skip_empty_lines: true
  })

// pour chaque site:
// .- le nombre de PDF exemptés
// - le nombre de fichiers en téléchargement / distrib
// - le % de PDF/ nb fichiers en téléchargemnet / distrib
// - le % de formulaires / nb de fichiers en téléchargement
// - nombre de PDF non exemptés
// - % de pb d'access / nb de PDF non exemptés
// - % de pb d'access graves / nb de PDF non exemptés

let results = {}

pdfCheck.forEach((line) =>  {
    if (results[line['Site']] === undefined) {
        results[line['Site']] = {'files':0, 'pdf':0, 'pdf-exempt':0, 'pdf-non-exempt': 0, 'pdf-form':0, 'pdf-pb-access':0, 'pdf-blocking-pb-access':0}
    }
    if (line['Exempt'].toLowerCase() == 'true') {
        results[line['Site']]['pdf-exempt']++
    } else {
        results[line['Site']]['pdf-non-exempt']++
        if (line['Accessible'].toLowerCase() == 'false') {
            results[line['Site']]['pdf-pb-access']++
        } 
        if (line['TotallyInaccessible'].toLowerCase() == 'true') {
            results[line['Site']]['pdf-blocking-pb-access']++
        }
    }
    if (line['Form'].toLowerCase() == 'true') {
        results[line['Site']]['pdf-form']++
    }
})

distrib.forEach((line) =>  {
    if (results[line['site']] !== undefined) {
        results[line['site']]['files'] = parseInt(line['files'])
        results[line['site']]['pdf'] = parseInt(line['files']) - parseInt(line['not-pdf'])
    }
})

Object.keys(results).forEach(site => {
    if (results[site]['files'] != 0) {
        results[site]['pcent-pdf'] = Math.round(results[site]['pdf']/results[site]['files'] * 100)
        results[site]['pcent-form'] = Math.round(results[site]['pdf-form']/results[site]['files'] * 100)
    }
    if (results[site]['pdf-non-exempt'] != 0) {
        results[site]['pcent-pdf-pb-access'] = Math.round(results[site]['pdf-pb-access']/results[site]['pdf-non-exempt'] * 100)
        results[site]['pcent-pdf-blocking-pb-access'] = Math.round(results[site]['pdf-blocking-pb-access']/results[site]['pdf-non-exempt'] * 100)
    }
})

fs.writeFileSync('./data/docs-bureautiques-03092021.json', JSON.stringify(results, null, 4))

