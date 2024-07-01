import dotenv from 'dotenv';
import { Client, Storage } from 'node-appwrite';
import { exec } from 'child_process';
import fs from 'fs';
import path from 'path';

dotenv.config();

export default async function(req, res) {
  try {
    if (!req.payload) {
      throw new Error('Payload is missing');
    }

    res.write('Received payload\n');
    console.log('Received payload:', req.payload);

    let payload;
    try {
      payload = JSON.parse(req.payload);
    } catch (error) {
      throw new Error('Failed to parse payload: ' + error.message);
    }

    const fileId = payload.fileId;
    console.log('Parsed fileId:', fileId);
    res.write(`Parsed fileId: ${fileId}\n`);

    const client = new Client();
    const storage = new Storage(client);

    client
      .setEndpoint(process.env.APPWRITE_ENDPOINT)
      .setProject(process.env.PROJECT_ID)
      .setKey(process.env.API_KEY);

    const filePath = path.join('/tmp', fileId);
    const file = await storage.getFileDownload(process.env.BUCKET_ID, fileId);

    const writer = fs.createWriteStream(filePath);
    file.pipe(writer);

    writer.on('finish', async () => {
      res.write('File download completed\n');

      const outputPath = path.join('/tmp', fileId, 'output');
      const hlsPath = path.join(outputPath, 'index.m3u8');
      const thumbnailPath = path.join(outputPath, 'thumbnail.jpg');

      if (!fs.existsSync(outputPath)) {
        fs.mkdirSync(outputPath, { recursive: true });
      }

      const ffmpegCommand = `
        ffmpeg -i ${filePath} -codec:v libx264 -codec:a aac -hls_time 10 -hls_playlist_type vod -hls_segment_filename "${outputPath}/segment%03d.ts" -start_number 0 ${hlsPath} -vf "thumbnail" -frames:v 1 ${thumbnailPath}
      `;

      exec(ffmpegCommand, async (error, stdout, stderr) => {
        if (error) {
          console.error(`exec error: ${error}`);
          res.write(`exec error: ${error.message}\n`);
          return res.end();
        }

        console.log(`stdout: ${stdout}`);
        console.log(`stderr: ${stderr}`);
        res.write(`FFmpeg stdout: ${stdout}\n`);
        res.write(`FFmpeg stderr: ${stderr}\n`);

        const hlsFiles = fs.readdirSync(outputPath).map(file => ({
          path: path.join(outputPath, file),
          name: file
        }));

        const hlsUrls = [];
        for (const hlsFile of hlsFiles) {
          const fileBuffer = fs.readFileSync(hlsFile.path);
          const uploadedFile = await storage.createFile(process.env.BUCKET_ID, 'unique()', fileBuffer, ['role:all'], ['role:all']);
          hlsUrls.push({
            name: hlsFile.name,
            url: getFilePreview(uploadedFile.$id)
          });
        }

        const thumbnailBuffer = fs.readFileSync(thumbnailPath);
        const thumbnailFile = await storage.createFile(process.env.BUCKET_ID, 'unique()', thumbnailBuffer, ['role:all'], ['role:all']);
        const thumbnailUrl = getFilePreview(thumbnailFile.$id);

        fs.unlinkSync(filePath);
        fs.rmdirSync(outputPath, { recursive: true });

        res.write('Video converted to HLS format\n');
        res.write(`HLS URLs: ${JSON.stringify(hlsUrls)}\n`);
        res.write(`Thumbnail URL: ${thumbnailUrl}\n`);
        res.end();
      });
    });

  } catch (error) {
    console.error('Error in cloud function:', error);
    res.write(`Error in cloud function: ${error.message}\n`);
    res.end();
  }
}

// Function to get the file preview URL
function getFilePreview(fileId) {
  return `${process.env.APPWRITE_ENDPOINT}/storage/buckets/${process.env.BUCKET_ID}/files/${fileId}/view`;
}
