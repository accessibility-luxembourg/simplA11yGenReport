const XLSX = require('xlsx')
const ejs = require('ejs')
const workbook = XLSX.readFile('agriculture.public.lu.xlsx')

for (let pageIdx = 1; pageIdx < 4; pageIdx++) {
    const sheet = workbook.Sheets['P0'+pageIdx]
    // D4 - D56 / B criteria / E dérogation / F comment

    for (let i = 4; i < 57; i++) {
        console.log(sheet['B'+i]['v'], sheet['D'+i]['v'], sheet['E'+i]['v'], sheet['F'+i]['w']);
    }

}

