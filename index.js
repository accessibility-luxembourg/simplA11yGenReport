const XLSX = require('xlsx')
const ejs = require('ejs')
const MarkdownIt = require('markdown-it')
const workbook = XLSX.readFile(process.argv[2])
let topics = require('./topics.json')
const fs = require('fs')
const p = require('path')
const declarations = require('./data/declarations-03092021.json')
const docs = require('./data/docs-bureautiques-03092021.json')
const { exit } = require('process')

const md = MarkdownIt({
    html: true,
    linkify: true,
    typographer: true,
    quotes: ['«\xA0', '\xA0»', '‹\xA0', '\xA0›']
  }).use(require('markdown-it-attrs'))

const mdForExcel = MarkdownIt({
    html: false,
    linkify: true,
  }).use(require('markdown-it-attrs'))

function cleanupSolutions(solutions) {
    Object.keys(solutions).forEach((topicIdx) => {
        solutions[topicIdx].forEach((solution, solutionIdx) => {
            if (typeof solution.desc !== "string") {
                solutions[topicIdx][solutionIdx].desc = solution.desc.join('\r\n')
            }
        })
    })
    return solutions
}
const solutions = cleanupSolutions(require('./solutions.json'))

function getFieldVal(sheet, x, y, type) {
    if (sheet[x+y]!== undefined) {
        return sheet[x+y][type]
    } else {
        return ''
    }
}

// read issues from Excel sheet
const issues = []
const topicsToDisplay = []
for (let pageIdx = 1; pageIdx < 4; pageIdx++) {
    const sheet = workbook.Sheets['P0'+pageIdx]
    // D4 - D56 / B criteria / E dérogation / F comment

    for (let i = 4; i < 57; i++) {
        // filter on NC and no derogation
        const criteria = getFieldVal(sheet, 'B', i, 'w')
        const topic = parseInt(criteria.replace(/\..+/,''))
        const status = getFieldVal(sheet, 'D', i, 'v')  
        const derogation = getFieldVal(sheet, 'E', i, 'v')
        const comment =  getFieldVal(sheet, 'F', i, 'w')
        if (status == 'NC' && derogation == 'N') {
            if (!topicsToDisplay.includes(topic)) {
                topicsToDisplay.push(topic)
            }
            issues.push({
                'topic':topic,
                'criteria': criteria,
                'status': status,
                'derogation': derogation,
                'comment': comment,
                'page': pageIdx
            })
        }
    }
}

// transform issues
topics = topics.filter(e => {return topicsToDisplay.includes(e.num); })


const info = {}
info['site'] = getFieldVal(workbook.Sheets['Échantillon'], 'B', '4', 'v')
info['date'] = getFieldVal(workbook.Sheets['Échantillon'], 'A', '3', 'v')
info['score'] = getFieldVal(workbook.Sheets['Résultats'], 'B', '4', 'v')
info['pages'] = []
for (let i=0; i<3; i++) {

    info['pages'][i] = {}
    info['pages'][i]['id'] = i+1
    info['pages'][i]['label'] = getFieldVal(workbook.Sheets['Échantillon'], 'B', i+7 , 'v')
    info['pages'][i]['value'] = getFieldVal(workbook.Sheets['Échantillon'], 'C', i+7 , 'v')
}

const siteName = process.argv[2].replace(/^.*\//,'').replace('.xlsx', '')
if (declarations[siteName] === undefined) {
    console.log('site not found in declarations: '+ siteName)
    exit(1)
} 
const declaration = declarations[siteName]
const docsInfos = docs[siteName]


// render issues
ejs.renderFile('./tpl/main.ejs', {topics: topics, md: md, mdForExcel: mdForExcel, info: info, solutions: solutions, issues: issues, declaration: declaration, docs: docsInfos}, function(err, str){
    if (err !== null) {
        console.log(err)
    }
    fs.writeFileSync('./out/rapport-'+siteName+'.html', str)
})



