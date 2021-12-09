# simplA11yGenReport

simplA11yReport is a tool supporting the simplified accessibility monitoring method as described in the [commission implementing decision EU 2018/1524](https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32018D1524&from=EN). It is used by [SIP (Information and Press Service)](https://sip.gouvernement.lu/en.html) in Luxembourg to monitor the websites of public sector bodies.
This tool generates a report from a spreadsheet containing the results of a simplified accessibility audit. The spreadsheet in input should follow the template generated by the tool [simplA11yMonit](https://github.com/accessibility-luxembourg/simplA11yMonit). The report includes contextual information about the issues reported in the spreadsheet.
The reports are currently only generated in French. The reports are made available in PDF and HTML formats.
Most of the [accessibility reports](https://data.public.lu/fr/datasets/audits-simplifies-de-laccessibilite-numerique-2020-2021/) published by SIP on [data.public.lu](https://data.public.lu) have been generated using [simplA11yMonit](https://github.com/accessibility-luxembourg/simplA11yMonit) and simplA11yGenReport.

## Requirements

In order to be able to run, this tool needs 4 files in the `./data` folder:
- `statements.json`: a file containing information about the presence of accessibility statements on websites to be controlled. Example: `{ "test.example.org": false, "gouvernement.lu": true}
- `office-files.json`: a file containing information about the office and PDF files present on the sites to be controlled. This file can be generated with the tool [simplA11yPDFAudit](https://github.com/accessibility-luxembourg/simplA11yPDFAudit)

## Installation

```
git clone https://github.com/accessibility-luxembourg/simplA11yGenReport.git
cd simplA11yGenReport
npm install
mkdir data && mkdir in && mkdir out
```

## Usage
It is possible to generate a report for one file with the following command:

```
./run.sh ./test.public.lu.xlsx
```
where test.public.lu is the url of the site to be tested, and test.public.lu.xlsx is the name of the spreadsheet containing the test results.

You can also generate reports for multiple files. In this case, store all the input files in the `./in` folder and launch the following command:

```
./genAll.sh
```
The reports will be stored in the ./out folder.

## Configuration
You can customise the templates to fit your needs.
Make a copy of the `tpl` folder in the location of your choice and set the `TPL_PATH` environment variable to the path of your custom templates.
Example: 

```
export TPL_PATH="../myCustomTemplates"
```

## License
This software is (c) Information and press service of the luxembourgish government and licensed under the MIT license.
