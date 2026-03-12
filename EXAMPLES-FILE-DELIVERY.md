# File Delivery Example

How agents can send files, images, and other media to users through Bark adapters.

## How It Works

1. **Driver generates a file** and calls `fileReadyCb()`
2. **BarkCore publishes FILE_READY event** to the event bus
3. **MessageRouter catches the event** and routes to the adapter
4. **Adapter sends the file** via platform-specific API (WhatsApp, Telegram, etc.)

## Example: Driver Implementation

```javascript
// Example: Sending a generated chart from Claude Code driver
class MyCustomDriver extends IDriver {
    async sendCommand(sessionId, cmd, systemPrompt, model, driverState = {}) {
        // ... execute command ...

        // When a file is generated (e.g., an image, PDF, etc.):
        if (this.fileReadyCb) {
            this.fileReadyCb({
                sessionId,
                filePath: '/tmp/generated-chart.png',
                mimeType: 'image/png',
                fileName: 'analysis-chart.png',
                caption: 'Here\'s the analysis chart for your data'
            });
        }
    }

    onFileReady(cb) {
        this.fileReadyCb = cb;
    }
}
```

## File Event Structure

```javascript
{
    sessionId: 'user-123',           // Required: which user to send to
    filePath: '/tmp/file.png',       // Required: local file path
    mimeType: 'image/png',           // Required: MIME type
    fileName: 'output.png',          // Optional: display name
    caption: 'Here is your chart'    // Optional: caption/description
}
```

## Supported Adapters

### WhatsApp
- Supports any file type that WhatsApp Web supports
- Images, videos, audio, documents, etc.
- Files sent with optional captions

### Telegram
- Images → `sendPhoto`
- Audio → `sendAudio`
- Video → `sendVideo`
- Everything else → `sendDocument`
- Optional captions on all media types

## Implementation in Your Driver

```javascript
// In your driver's sendCommand or wherever files are generated:

// 1. Create/generate the file
const filePath = '/tmp/chart.pdf';
// ... write file to disk ...

// 2. Emit the FILE_READY event
if (this.fileReadyCb) {
    this.fileReadyCb({
        sessionId,
        filePath,
        mimeType: 'application/pdf',
        fileName: 'report.pdf',
        caption: 'Generated PDF report'
    });
}
```

## Testing

To test file delivery:

1. Create a test file in your project
2. Call the `fileReadyCb` callback from your driver
3. The file will be automatically sent to the user through their connected adapter

Example test setup:
```javascript
const driver = new MyDriver();
driver.onFileReady((event) => {
    console.log('File ready event:', event);
    // Router will handle sending this to the adapter
});

// Trigger file generation
await driver.sendCommand('test-session', 'generate chart');
```

## File Path Handling

- Drivers are responsible for writing files to disk
- Adapters read from the file path and upload/send
- Files can be stored in `/tmp`, temporary directories, or project folders
- Consider cleanup after sending (optional - adapters don't delete files)

## Error Handling

If a file fails to send:
- Router logs the error and continues
- The error won't crash the entire session
- User won't receive the file but can continue chatting

```javascript
// Router error handling (automatic):
await r.adapter.sendFile(r.replyTo, {
    filePath: event.filePath,
    // ...
}).catch(err => {
    this.logger.error(`[MessageRouter] Failed to send file:`, err);
});
```
