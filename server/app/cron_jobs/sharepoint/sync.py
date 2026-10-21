import asyncio
import datetime
import logging

from fastapi import HTTPException

from app.helpers.config.system_config_service import SystemConfigService
from app.helpers.ff.sharepoint_sync_service import SharePointSyncService
from config.database import async_session

logger = logging.getLogger(__name__)

async def sharepoint_sync_loop():
    """
    Background polling loop to check SharePoint and ingest new files at specific daily times.
    """
    try:
        enabled_str = await SystemConfigService.get_from_db("sharepoint_sync_background_poll", default="true")
        enabled = enabled_str.strip().lower() in ("true", "1", "yes", "on", "t")
        if not enabled:
            logger.info("SharePoint background sync is disabled (sharepoint_sync_background_poll=false).")
            return

        sync_service = SharePointSyncService()
        last_trigger_key = None

        while True:
            try:
                times_str = await SystemConfigService.get_from_db("sharepoint_sync_schedule_times", default="")
                scheduled_times = {t.strip() for t in times_str.split(",") if t.strip()}

                now = datetime.datetime.now()
                time_str = now.strftime("%H:%M")
                date_str = now.strftime("%Y-%m-%d")
                current_trigger_key = f"{date_str}_{time_str}"

                if time_str in scheduled_times and current_trigger_key != last_trigger_key:
                    logger.info(f"Background Scheduler: Time {time_str} reached. Initiating SharePoint sync...")
                    last_trigger_key = current_trigger_key

                    async with async_session() as db:
                        result = await sync_service.check_and_ingest_new_files(db)

                        # Also sync the presence of PDF documents in F&F_Documents folder
                        logger.info("Background Scheduler: Initiating F&F document presence sync...")
                        doc_result = await sync_service.sync_fnf_document_presence(db)

                    if result["files_ingested"] > 0:
                        logger.info(f"Background Scheduler: Successfully ingested {result['files_ingested']} new file(s).")
                    elif result["status"] == "failed":
                        logger.error(f"Background Scheduler: SharePoint Excel sync failed. Errors: {result['errors']}")
                    else:
                        logger.info("Background Scheduler: No new Excel files found on SharePoint.")

                    if doc_result["status"] == "failed":
                        logger.error(f"Background Scheduler: F&F Document sync failed. Errors: {doc_result['errors']}")
                    else:
                        logger.info(f"Background Scheduler: Document sync completed. Found {doc_result.get('folders_found')} F&F folders.")

            except asyncio.CancelledError:
                logger.info("Background Scheduler task cancelled.")
                break
            except Exception as e:
                logger.exception(f"Background Scheduler: Error during SharePoint sync check: {e}")

            # Check current time every 30 seconds
            try:
                await asyncio.sleep(30)
            except asyncio.CancelledError:
                logger.info("Background Scheduler sleep cancelled.")
                break
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f'Error in sharepoint_sync_loop: {e}', exc_info=True)
        raise HTTPException(status_code=500, detail='An internal server error occurred.')
