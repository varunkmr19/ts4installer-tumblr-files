(async () => {

let q = window.location.search;
const ACTION = (q == '?new=' ? 'create' : 'validate');
let SKIP_LANG_FILES = q.indexOf('skip_lang_files') > -1;
let QUICK_SCAN = q.indexOf('full_scan') == -1;
const FORMAT = (q.indexOf('disqus') > -1 ? 'Disqus' : (q.indexOf('discord') > -1 ? 'Discord' : 'Forum'))
q = undefined;

const FORMAT_DICT = {
  'Forum': {
    start: '[spoiler="report"]\n',
    end: '[/spoiler]',
    bold_s: '[b]',
    bold_e: '[/b]',
    head_s: '[color=#026526][b][u]',
    head_e: '[/u][/b][/color]'
  },
  'Disqus': {
    start: '<blockquote><code>',
    end: '</code></blockquote>',
    bold_s: '<b>',
    bold_e: '</b>',
    head_s: '</code><a><b>',
    head_e: '</b></a><code>'
  },
  'Discord': {
    start: '```yaml\n',
    end: '```',
    bold_s: '',
    bold_e: '',
    head_s: '#',
    head_e: ''
  }
};

// generate reports for all formats
const generateReports = (version, folder, mismatch, missing, unknown) => {
  for(let formatName of Object.keys(FORMAT_DICT)) {
    let f = FORMAT_DICT[formatName],
        report = (f.start + 'Version: ' + f.bold_s + version + f.bold_e
          + '\nFolder: ' + f.bold_s + folder + f.bold_e + '\n'

          + f.head_s + 'Hash mismatch:' + f.head_e
          + '\n' + mismatch + '\n'

          + f.head_s + 'Missing files:' + f.head_e
          + '\n' + missing + '\n'

          + f.head_s + 'Unknown files:' + f.head_e
          + '\n' + unknown + '\n'
          
          + f.end),
        $card = $('.template > .card').clone();

    $card.find('textarea').val(report)
    $card.find('button')
      .attr('data-target', `#c-${formatName}`)
      .html(formatName);
    $card.find('.collapse')
      .attr('id', `c-${formatName}`)
      .collapse((formatName == FORMAT ? 'show' : 'hide'));

    $('#report').append($card);
  }
  $('#report').show();
};

// calculate missing hashes and return simplified object
const calculateHashes = async filesInfo => {
  let hashes = {}, processedSize = 0, totalSize = 0;

  $('#hashing').show();

  for(let path of Object.keys(filesInfo)) {
    totalSize += filesInfo[path].file.size;
  }
  for(let path of Object.keys(filesInfo)) {
    let fileInfo = filesInfo[path];
    if(typeof fileInfo.hash == 'undefined') {
      hashes[path] = (QUICK_SCAN ? '' : await calculateMD5(fileInfo.file));
    }
    else
      hashes[path] = fileInfo.hash;
    processedSize += fileInfo.file.size
    let progress = prog2percent(processedSize / totalSize);
    $('#total-progress')
      .css('width', progress)
      .html(progress);
  }

  $('#hashing').hide();

  return hashes;
};

// validate game files
const validate = async (version, filesInfo, folderName) => {
  let response = await fetch(`${GITHUB_URL}hashes/${version}.json`),
      missing = [], unknown = [], mismatch = [];

  if(!response.ok) {
    alert(`hashes for version ${version} not found on server`);
    return;
  }

  let serverHashes = await response.json();

  for(let path of Object.keys(filesInfo)) {
    if(typeof serverHashes[path] == 'undefined') {
      unknown.push(path);
      delete filesInfo[path];
    }
  }

  let userHashes = await calculateHashes(filesInfo);

  for(let path of Object.keys(userHashes)) {
    let hash = serverHashes[path];
    if(hash !== userHashes[path])
      mismatch.push(path);
    delete serverHashes[path];
  }

  if(SKIP_LANG_FILES)
    for(let path of Object.keys(serverHashes)) {
      if(path.match(/\/strings_[a-df-z][a-z]{2}_[a-z]{2}\.package/i))
        delete serverHashes[path];
    }

  if(QUICK_SCAN)
    mismatch = ['--- quick scan ---'];

  missing = Object.keys(serverHashes);

  generateReports(
    version, folderName,
    mismatch.sort().join('\n'),
    missing.sort().join('\n'),
    unknown.sort().join('\n')
  );
};

// create .json file for new version
const create = async (version, filesInfo) => {
  let userHashes = await calculateHashes(filesInfo),
      blob = new Blob([JSON.stringify(userHashes)], {type: 'application/json;charset=utf-8'});
  saveAs(blob, `${version}.json`);
};

// read file (blob) as text or array buffer asynchronously
const readAs = (file, type) => new Promise(resolve => {
  let reader = new FileReader();
  reader.onload = e => {
    resolve(e.target.result);
  };
  if(type == 'text')
    reader.readAsText(file);
  else
    reader.readAsArrayBuffer(file);
});

const prog2percent = prog => Math.min(100, 100 * prog).toFixed() + '%';

const calculateMD5 = async file => {
  let md5 = CryptoJS.algo.MD5.create();

  $('#hashing-name').html(file.webkitRelativePath);
  for(let size=file.size, chunkSize = 2*1024*1024, offset=0; offset<size; offset+=chunkSize) {
    let progress = prog2percent(offset / size);
    $('#hashing-progress')
      .css('width', progress)
      .html(progress);
    let fileSlice = file.slice(offset, offset + chunkSize),
        chunk = await readAs(fileSlice, 'arraybuffer'),
        wordArray = CryptoJS.lib.WordArray.create(chunk);
    md5.update(wordArray);
  }
  $('#hashing-progress').css('width', '100%').html('100%');

  let hash = md5.finalize();
  return hash.toString(CryptoJS.enc.Hex).toLowerCase();
};

// add hashes from .md5 file to `filesInfo`
const processMD5 = async (file, info) => {
  let text = await readAs(file, 'text'),
      lines = text.split(/[\r\n]+/);

  for(let line of lines) {
    let matches = line.match(/^(.{32})\s\*(.*)$/);
    if(matches) {
      let [_, hash, path] = matches,
          pathElems = path.toLowerCase().split(/\\|\//);
      pathElems.shift();
      path = pathElems.join('/');

      try {
        info[path].hash = hash.toLowerCase();
      }
      catch(ignore) {}
    }
  }
};

await addJS('https://cdnjs.cloudflare.com/ajax/libs/crypto-js/3.1.9-1/core.min.js', 'sha384-j/yjQ26lM3oABUyp5sUcxbbLK/ECT6M4bige54dRtJcbhk+j6M8GAt+ZJYPK3q/l')
await Promise.all([
  addJS('https://cdnjs.cloudflare.com/ajax/libs/crypto-js/3.1.9-1/md5.min.js', 'sha384-FvUg0oOjwQ1uec6J22LkHkEihYZfQYU5BaPKoUpt5OUVr7+CKyX2o5NC/fOqFGih'),
  addJS('https://cdnjs.cloudflare.com/ajax/libs/crypto-js/3.1.9-1/lib-typedarrays.min.js', 'sha384-ntzxweGwO+bdybZB6NfRCrCbK1X5djqon4rquDPIQFe1jBTZ5KZ1qnoTZCup5Nwh')
]);

if(ACTION == 'create')
  await addJS('https://cdnjs.cloudflare.com/ajax/libs/FileSaver.js/1.3.8/FileSaver.min.js', 'sha384-VgWGwiEJnh9P379lbU8DxPcfRuFkfLl0uPuL9tolOHtm2tx8Qy8d/KtvovfM0Udh')

$('#user-input').append(`  <div class="form-check">
    <input class="form-check-input" type="checkbox" id="quick-scan">
    <label class="form-check-label" for="quick-scan">Quick scan (shows only missing and unknown files)</label>
  </div>
  <div class="form-group">
    <label for="md5-picker">Select .md5 file (optional)</label>
    <input type="file" class="form-control-file" id="md5-picker" accept=".md5">
  </div>
  <div class="form-group">
    <label for="directory-picker">Select your The Sims 4 directory</label>
    <input type="file" class="form-control-file" id="directory-picker" webkitdirectory directory>
  </div>`);
$('#report').after(`<div class="template" style="display: none">
  <div class="card">
    <div class="card-header">
      <button class="btn btn-link" type="button" data-toggle="collapse"></button>
    </div>
    <div class="collapse" data-parent="#report">
      <textarea class="form-control" rows="10"></textarea>
    </div>
  </div>
</div>`);

$('#quick-scan').on('change', e => {
  $('#md5-picker').prop('disabled', (
    $('#quick-scan').prop('checked') ? 'disabled' : ''
  ));
});

if(QUICK_SCAN)
  $('#quick-scan').click();

// prepare and process info
$('#directory-picker').on('change', async e => {
  let files = e.target.files,
      md5File = $('#md5-picker')[0].files[0],
      version = '', filesInfo = {}, folderName,
      wrongFolder = true;

  QUICK_SCAN = $('#quick-scan').prop('checked');

  if(files.length > 0)
    folderName = files[0].webkitRelativePath.split(/\\|\//)[0];

  for(let file of files) {
    let pathElems = file.webkitRelativePath.toLowerCase().split(/\\|\//);
    pathElems.shift();
    let path = pathElems.join('/');
    filesInfo[path] = {
      file: file
    }

    // detect game version
    if(path == 'game/bin/default.ini') {
      wrongFolder = false;
      let ini = await readAs(file, 'text'),
          matches = ini.match(/^\s*gameversion\s*=\s*([\d\.]+)\s*$/m);
      if(matches && matches.length > 1)
        version = matches[1];
    }
    else if(path == 'game/bin/codex.cfg' && version == '') {
      wrongFolder = false;
      let cfg = await readAs(file, 'text'),
          matches = cfg.match(/^\s*"Version"\s+"([\d\.]+)"\s*$/m);
      if(matches && matches.length > 1)
        version = matches[1];
    }
    else if(
        path == 'data/simulation/simulationfullbuild0.package'
        || path == 'data/simulation/simulationdeltabuild0.package')
      wrongFolder = false;
  }

  if(version == '') {
    if(wrongFolder) {
      alert('could not detect game version, wrong directory selected');
      return;
    }
    else
      version = prompt('Could not detect game version. Enter manually (eg. 1.46.18.1020)');
  }

  if(typeof md5File !== 'undefined')
    await processMD5(md5File, filesInfo);

  // ignore some files
  for(let path of Object.keys(filesInfo)) {
    if(// G4TW's files
       path.startsWith('#') ||
       // can play without it
       path.startsWith('__installer/') ||
       path.startsWith('soundtrack/') ||
       path.startsWith('support/') ||
       // my tools
       path.startsWith('language-changer.') ||
       path.startsWith('dlc-toggler.') ||
       // from MAC
       path.endsWith('/.ds_store') ||
       // safe to ignore, they should not be there but don't affect the game
       path.endsWith('.rar') ||
       path.endsWith('.bak') ||
       path.endsWith('.lnk') ||
       path.endsWith('.tmp')) {
      delete filesInfo[path];
    }
  }

  $('#user-input').hide();

  if(ACTION == 'create')
    create(version, filesInfo);
  else
    validate(version, filesInfo, folderName);
});

})();