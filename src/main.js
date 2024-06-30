const sdk = require('node-appwrite');
const { exec } = require('child_process');
const fs = require('fs');

module.exports = async (req, res) => {
  const client = new sdk.Client();
  const storage = new sdk.Storage(client);

  client
    .setEndpoint(process.env.APPWRITE_ENDPOINT) // Set your Appwrite endpoint
    .setProject(process.env.PROJECT_ID) // Set your Appwrite project ID
    .setKey(process.env.API_KEY); // Set your Appwrite API key

  const payload = JSON.parse(req.payload);
  const fileId = payload.fileId;

  // Download the video file from Appwrite storage
  const filePath = `/tmp/${fileId}`;
  await storage.getFileDownload('YOUR_BUCKET_ID', fileId, filePath);

  const outputPath = `/tmp/${fileId}/output`;
  const hlsPath = `${outputPath}/index.m3u8`;

  if (!fs.existsSync(outputPath)) {
    fs.mkdirSync(outputPath, { recursive: true });
  }

  // FFmpeg command to convert video to HLS format
  const ffmpegCommand = `ffmpeg -i ${filePath} -codec:v libx264 -codec:a aac -hls_time 10 -hls_playlist_type vod -hls_segment_filename "${outputPath}/segment%03d.ts" -start_number 0 ${hlsPath}`;

  exec(ffmpegCommand, async (error, stdout, stderr) => {
    if (error) {
      console.error(`exec error: ${error}`);
      return res.json({ error: error.message });
    }

    console.log(`stdout: ${stdout}`);
    console.log(`stderr: ${stderr}`);

    // Upload HLS files back to Appwrite storage
    const hlsFile = fs.readFileSync(hlsPath);
    const uploadedHlsFile = await storage.createFile('YOUR_BUCKET_ID', 'unique()', hlsFile, ['role:all'], ['role:all']);

    // Clean up local files
    fs.unlinkSync(filePath);
    fs.rmdirSync(outputPath, { recursive: true });

    res.json({ videoUrl: uploadedHlsFile.$id });
  });
};
