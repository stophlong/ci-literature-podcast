const CONFIG = {
  DROP_FOLDER_ID: '1uXFfTH1nGso7-0MO79glYlLhI_Nfy9II',
  PROCESSED_FOLDER_ID: '1LnXGtS29b_0XYAvJ0m-18rV90Ku5QYNb',
  GITHUB_USER: 'YOUR_GITHUB_USERNAME',
  GITHUB_REPO: 'ci-literature-podcast',
  GITHUB_TOKEN: 'PASTE_GITHUB_PAT_TOKEN'
};

function publishNewEpisodes() {
  const dropFolder = DriveApp.getFolderById(CONFIG.DROP_FOLDER_ID);
  const processedFolder = DriveApp.getFolderById(CONFIG.PROCESSED_FOLDER_ID);
  const files = dropFolder.getFiles();
  
  const fileMap = {};
  while (files.hasNext()) {
    const file = files.next();
    const name = file.getName();
    const baseName = name.replace(/\.(json|mp3|m4a|wav)$/i, '');
    if (!fileMap[baseName]) fileMap[baseName] = {};
    if (name.endsWith('.json')) fileMap[baseName].json = file;
    else if (/\.(mp3|m4a|wav)$/i.test(name)) fileMap[baseName].audio = file;
  }

  for (const baseName in fileMap) {
    const pair = fileMap[baseName];
    if (pair.json && pair.audio) {
      processEpisodePair(pair.json, pair.audio, processedFolder);
    }
  }
}

function processEpisodePair(jsonFile, audioFile, processedFolder) {
  const meta = JSON.parse(jsonFile.getBlob().getDataAsString());
  const tag = 'ep-' + new Date().getTime();
  const safeFileName = tag + '.mp3';

  // 1. Create a GitHub Release to host the 32MB+ audio binary cleanly
  const releaseUrl = `https://api.github.com/repos/${CONFIG.GITHUB_USER}/${CONFIG.GITHUB_REPO}/releases`;
  const releaseRes = UrlFetchApp.fetch(releaseUrl, {
    method: 'post',
    headers: {
      'Authorization': `Bearer ${CONFIG.GITHUB_TOKEN}`,
      'Accept': 'application/vnd.github+json'
    },
    payload: JSON.stringify({
      tag_name: tag,
      name: meta.title,
      body: meta.summary
    })
  });
  const releaseData = JSON.parse(releaseRes.getContentText());

  // 2. Upload the raw MP3 binary to the Release Asset URL (bypasses Base64 limit)
  const uploadUrl = releaseData.upload_url.replace('{?name,label}', `?name=${safeFileName}`);
  const audioBlob = audioFile.getBlob();
  const assetRes = UrlFetchApp.fetch(uploadUrl, {
    method: 'post',
    contentType: 'audio/mpeg',
    headers: {
      'Authorization': `Bearer ${CONFIG.GITHUB_TOKEN}`,
      'Accept': 'application/vnd.github+json'
    },
    payload: audioBlob.getBytes()
  });
  const assetData = JSON.parse(assetRes.getContentText());
  const publicAudioUrl = assetData.browser_download_url;

  // 3. Fetch rss.xml, insert the new <item>, and commit back to GitHub Pages
  updateRssXml(meta.title, meta.summary, publicAudioUrl, audioFile.getSize(), tag);

  // 4. Move processed files so they aren't published again
  jsonFile.moveTo(processedFolder);
  audioFile.moveTo(processedFolder);
}

function updateRssXml(title, summary, audioUrl, byteLength, guid) {
  const rssApiUrl = `https://api.github.com/repos/${CONFIG.GITHUB_USER}/${CONFIG.GITHUB_REPO}/contents/rss.xml`;
  const getRes = UrlFetchApp.fetch(rssApiUrl, {
    headers: { 'Authorization': `Bearer ${CONFIG.GITHUB_TOKEN}` }
  });
  const fileData = JSON.parse(getRes.getContentText());
  const currentXml = Utilities.newBlob(Utilities.base64Decode(fileData.content)).getDataAsString();

  const escapeXml = (str) => str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const pubDate = new Date().toUTCString();
  const formattedSummary = summary.replace(/\n/g, '<br/>');

  const newItem = `
    <item>
      <title>${escapeXml(title)}</title>
      <description><![CDATA[${formattedSummary}]]></description>
      <pubDate>${pubDate}</pubDate>
      <guid isPermaLink="false">${guid}</guid>
      <enclosure url="${audioUrl}" length="${byteLength}" type="audio/mpeg"/>
    </item>`;

  const updatedXml = currentXml.replace('<!-- EPISODES_INSERT_HERE -->', `<!-- EPISODES_INSERT_HERE -->\n${newItem}`);

  UrlFetchApp.fetch(rssApiUrl, {
    method: 'put',
    headers: {
      'Authorization': `Bearer ${CONFIG.GITHUB_TOKEN}`,
      'Accept': 'application/vnd.github+json'
    },
    payload: JSON.stringify({
      message: `Add episode: ${title}`,
      content: Utilities.base64Encode(updatedXml, Utilities.Charset.UTF_8),
      sha: fileData.sha
    })
  });
}
