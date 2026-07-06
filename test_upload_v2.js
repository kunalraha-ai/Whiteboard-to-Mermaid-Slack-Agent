const { WebClient } = require('@slack/web-api');
require('dotenv').config();

const client = new WebClient(process.env.SLACK_BOT_TOKEN);

async function run() {
  try {
    console.log("Attempting files.uploadV2 to see response shape...");
    // Let's create a small temp file to upload
    const fs = require('fs');
    fs.writeFileSync('temp_test.txt', 'hello slack files.uploadV2');

    const res = await client.files.uploadV2({
      channel_id: 'C0BESDQG01J',
      file: fs.createReadStream('temp_test.txt'),
      filename: 'temp_test.txt',
      title: 'Temp Test File'
    });
    console.log("Upload succeeded!");
    console.log("Raw response object:");
    console.log(JSON.stringify(res, null, 2));

    if (fs.existsSync('temp_test.txt')) {
      fs.unlinkSync('temp_test.txt');
    }
  } catch (error) {
    console.error("Upload failed with error:", error);
    if (error.data) {
      console.error("Error data:", JSON.stringify(error.data, null, 2));
    }
  }
}

run();
