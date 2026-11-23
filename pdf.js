// Print the local report using Chromium. Keep browser installation explicit.
const { chromium } = require('playwright')
const { pathToFileURL } = require('url')
const path = require('path')
const fs = require('fs')

function escapeHtml(value) {
    return value.replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]))
}

async function generatePdf(input, output) {
    if (!input || !output) throw new Error('Usage: node pdf.js report.html report.pdf')
    fs.accessSync(input)
    let browser
    const temporary = path.resolve(output) + '.tmp'
    try {
        browser = await chromium.launch()
        const page = await browser.newPage()
        await page.goto(pathToFileURL(path.resolve(input)).href, { waitUntil: 'load' })
        await page.emulateMedia({ media: 'print' })
        await page.evaluate(() => document.fonts.ready)
        const customHeader = await page.locator('template#pdf-header').evaluateAll(nodes => nodes[0]?.innerHTML || '')
        const customFooter = await page.locator('template#pdf-footer').evaluateAll(nodes => nodes[0]?.innerHTML || '')
        const site = await page.locator('#site').textContent()
        await page.pdf({
            path: temporary,
            format: 'A4',
            preferCSSPageSize: true,
            printBackground: true,
            tagged: true,
            outline: true,
            displayHeaderFooter: true,
            headerTemplate: customHeader || '<span></span>',
            footerTemplate: customFooter || `<div style="font-family:Arial,sans-serif;font-size:8px;width:100%;padding:0 15mm;display:flex;justify-content:space-between;gap:8px"><span>Audit d’accessibilité simplifié</span><span>${escapeHtml(site || '')}</span><span><span class="pageNumber"></span>/<span class="totalPages"></span></span></div>`
        })
        fs.renameSync(temporary, path.resolve(output))
        console.log('PDF saved: ' + output)
    } finally {
        if (browser) await browser.close()
        if (fs.existsSync(temporary)) fs.unlinkSync(temporary)
    }
}

if (require.main === module) {
    generatePdf(process.argv[2], process.argv[3]).catch(error => {
        console.error(error.message)
        if (/Executable doesn't exist/.test(error.message)) console.error('Install Chromium first: npx playwright install chromium')
        process.exitCode = 1
    })
}
module.exports = { generatePdf }
