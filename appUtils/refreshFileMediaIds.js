import cron from 'node-cron';
import connection from '../db.js';
import { getOrUploadFileMediaId } from '../mediaController/mediaUtils.js';

const BUSINESS_PHONE_NUMBER_ID = process.env.MY_PHONE_NUMBER_ID;

let isRunning = false;

async function refreshFileMediaIds() {
  if (isRunning) {
    console.log('[Media Refresh] Previous refresh is still running. Skipping.');
    return;
  }

  if (!BUSINESS_PHONE_NUMBER_ID) {
    console.error(
      '[Media Refresh] WHATSAPP_BUSINESS_PHONE_NUMBER_ID is not configured.'
    );
    return;
  }

  isRunning = true;

  try {
    console.log('[Media Refresh] Starting scheduled refresh...');

    const [files] = await connection.execute(`
      SELECT *
      FROM files
      WHERE file_data IS NOT NULL
        AND (
          media_uploaded_at IS NULL
          OR media_uploaded_at <= DATE_SUB(NOW(), INTERVAL 10 DAY)
        )
      ORDER BY id ASC
    `);

    if (files.length === 0) {
      console.log('[Media Refresh] No files need refreshing.');
      return;
    }

    console.log(`[Media Refresh] ${files.length} file(s) need refreshing.`);

    let succeeded = 0;
    let failed = 0;

    // Process sequentially to avoid uploading multiple large PDFs at once.
    for (const file of files) {
      try {
        const filename =
          `${String(file.title || 'document').replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')}.${String(file.file_type || 'pdf').replace(/^\./, '')}`;

        await getOrUploadFileMediaId(
          file,
          BUSINESS_PHONE_NUMBER_ID,
          filename,
          true
        );

        succeeded++;

        console.log(
          `[Media Refresh] Successfully refreshed "${file.title}" (ID ${file.id}).`
        );
      } catch (error) {
        failed++;

        console.error(
          `[Media Refresh] Failed for "${file.title}" (ID ${file.id}):`,
          error.response?.data || error.message
        );
      }
    }

    console.log(
      `[Media Refresh] Completed. Successful: ${succeeded}; Failed: ${failed}.`
    );
  } catch (error) {
    console.error(
      '[Media Refresh] Job failed:',
      error.response?.data || error.message
    );
  } finally {
    isRunning = false;
  }
}

// Check daily at 03:00 in Zimbabwe.
cron.schedule('0 3 * * *', refreshFileMediaIds, {
  timezone: 'Africa/Harare',
});

console.log('[Media Refresh] Scheduled daily at 03:00 Africa/Harare.');

export { refreshFileMediaIds };