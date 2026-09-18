package com.parikshith.pocketpdf;

import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Environment;
import android.provider.MediaStore;
import android.provider.OpenableColumns;
import android.util.Base64;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.BufferedOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.Map;

/**
 * File plumbing the WebView can't do on its own:
 *  - write files (in chunks) to Downloads/Pocket PDF, or to a private cache folder for sharing
 *  - share / open a saved file with other apps
 *  - read a content:// URI (used when another app opens a PDF with this one)
 */
@CapacitorPlugin(name = "PocketFiles")
public class PocketFilesPlugin extends Plugin {

    private static class Sink {
        OutputStream out;
        Uri mediaUri;   // set when saving to Downloads
        File cacheFile; // set when saving to the share cache
    }

    private final Map<String, Sink> sinks = new HashMap<>();
    private final Map<String, InputStream> sources = new HashMap<>();
    private int nextId = 1;

    // ───────── writing ─────────

    @PluginMethod
    public void begin(PluginCall call) {
        String name = call.getString("name", "file");
        String mime = call.getString("mime", "application/octet-stream");
        boolean cache = "cache".equals(call.getString("target"));
        try {
            Sink sink = new Sink();
            if (cache) {
                File dir = new File(getContext().getCacheDir(), "share");
                //noinspection ResultOfMethodCallIgnored
                dir.mkdirs();
                sink.cacheFile = new File(dir, name.replace('/', '_'));
                sink.out = new BufferedOutputStream(new FileOutputStream(sink.cacheFile));
            } else {
                ContentValues values = new ContentValues();
                values.put(MediaStore.Downloads.DISPLAY_NAME, name);
                values.put(MediaStore.Downloads.MIME_TYPE, mime);
                values.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/Pocket PDF" + safeFolder(call.getString("folder", "")));
                values.put(MediaStore.Downloads.IS_PENDING, 1);
                ContentResolver resolver = getContext().getContentResolver();
                sink.mediaUri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
                if (sink.mediaUri == null) throw new IOException("Could not create the file");
                sink.out = resolver.openOutputStream(sink.mediaUri);
                if (sink.out == null) throw new IOException("Could not open the file for writing");
            }
            String id = String.valueOf(nextId++);
            sinks.put(id, sink);
            JSObject ret = new JSObject();
            ret.put("id", id);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject(String.valueOf(e.getMessage()), e);
        }
    }

    @PluginMethod
    public void append(PluginCall call) {
        Sink sink = sinks.get(call.getString("id", ""));
        String data = call.getString("data");
        if (sink == null || data == null) { call.reject("Bad write request"); return; }
        try {
            sink.out.write(Base64.decode(data, Base64.NO_WRAP));
            call.resolve();
        } catch (Exception e) {
            call.reject(String.valueOf(e.getMessage()), e);
        }
    }

    @PluginMethod
    public void finish(PluginCall call) {
        String id = call.getString("id", "");
        Sink sink = sinks.remove(id);
        if (sink == null) { call.reject("Unknown file"); return; }
        try {
            sink.out.close();
            JSObject ret = new JSObject();
            if (sink.mediaUri != null) {
                ContentValues done = new ContentValues();
                done.put(MediaStore.Downloads.IS_PENDING, 0);
                getContext().getContentResolver().update(sink.mediaUri, done, null, null);
                ret.put("uri", sink.mediaUri.toString());
                String finalName = displayName(sink.mediaUri);
                if (finalName != null) ret.put("name", finalName); // may differ if the name was taken
            } else {
                Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", sink.cacheFile);
                ret.put("uri", uri.toString());
                ret.put("name", sink.cacheFile.getName());
            }
            call.resolve(ret);
        } catch (Exception e) {
            call.reject(String.valueOf(e.getMessage()), e);
        }
    }

    @PluginMethod
    public void abort(PluginCall call) {
        Sink sink = sinks.remove(call.getString("id", ""));
        if (sink != null) {
            try { sink.out.close(); } catch (IOException ignored) { }
            if (sink.mediaUri != null) getContext().getContentResolver().delete(sink.mediaUri, null, null);
            if (sink.cacheFile != null) //noinspection ResultOfMethodCallIgnored
                sink.cacheFile.delete();
        }
        call.resolve();
    }

    // ───────── sharing / opening ─────────

    @PluginMethod
    public void share(PluginCall call) {
        try {
            JSArray list = call.getArray("uris");
            ArrayList<Uri> uris = new ArrayList<>();
            for (int i = 0; i < list.length(); i++) uris.add(Uri.parse(list.getString(i)));
            if (uris.isEmpty()) { call.reject("Nothing to share"); return; }

            Intent send = new Intent(uris.size() == 1 ? Intent.ACTION_SEND : Intent.ACTION_SEND_MULTIPLE);
            send.setType(call.getString("mime", "*/*"));
            if (uris.size() == 1) send.putExtra(Intent.EXTRA_STREAM, uris.get(0));
            else send.putParcelableArrayListExtra(Intent.EXTRA_STREAM, uris);
            ClipData clip = ClipData.newRawUri("", uris.get(0));
            for (int i = 1; i < uris.size(); i++) clip.addItem(new ClipData.Item(uris.get(i)));
            send.setClipData(clip);
            send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);

            Intent chooser = Intent.createChooser(send, null);
            chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(chooser);
            call.resolve();
        } catch (Exception e) {
            call.reject(String.valueOf(e.getMessage()), e);
        }
    }

    @PluginMethod
    public void open(PluginCall call) {
        try {
            Intent view = new Intent(Intent.ACTION_VIEW);
            view.setDataAndType(Uri.parse(call.getString("uri", "")), call.getString("mime", "*/*"));
            view.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(view);
            call.resolve();
        } catch (ActivityNotFoundException e) {
            call.reject("No app on this phone can open that file type");
        } catch (Exception e) {
            call.reject(String.valueOf(e.getMessage()), e);
        }
    }

    // ───────── reading a content:// URI ─────────

    @PluginMethod
    public void openRead(PluginCall call) {
        try {
            Uri uri = Uri.parse(call.getString("uri", ""));
            InputStream in = getContext().getContentResolver().openInputStream(uri);
            if (in == null) throw new IOException("Could not open the file");
            String id = String.valueOf(nextId++);
            sources.put(id, in);

            JSObject ret = new JSObject();
            ret.put("id", id);
            ret.put("name", displayName(uri));
            ret.put("size", querySize(uri));
            call.resolve(ret);
        } catch (Exception e) {
            call.reject(String.valueOf(e.getMessage()), e);
        }
    }

    @PluginMethod
    public void read(PluginCall call) {
        InputStream in = sources.get(call.getString("id", ""));
        if (in == null) { call.reject("Unknown file"); return; }
        try {
            int want = call.getInt("length", 786432);
            byte[] buf = new byte[want];
            int n = 0;
            while (n < want) {
                int r = in.read(buf, n, want - n);
                if (r < 0) break;
                n += r;
            }
            byte[] out = n == want ? buf : java.util.Arrays.copyOf(buf, n);
            JSObject ret = new JSObject();
            ret.put("data", Base64.encodeToString(out, Base64.NO_WRAP));
            ret.put("eof", n < want);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject(String.valueOf(e.getMessage()), e);
        }
    }

    @PluginMethod
    public void closeRead(PluginCall call) {
        InputStream in = sources.remove(call.getString("id", ""));
        if (in != null) try { in.close(); } catch (IOException ignored) { }
        call.resolve();
    }

    // ───────── helpers ─────────

    /** "a/b" -> "/a/b"; drops empty, "." and ".." segments so a ZIP can't write outside its folder. */
    private static String safeFolder(String folder) {
        StringBuilder sb = new StringBuilder();
        for (String part : folder.replace('\\', '/').split("/")) {
            String p = part.replaceAll("[:*?\"<>|]", "_").trim();
            if (p.isEmpty() || p.equals(".") || p.equals("..")) continue;
            sb.append('/').append(p);
        }
        return sb.toString();
    }

    private String displayName(Uri uri) {
        try (Cursor c = getContext().getContentResolver().query(uri, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
            if (c != null && c.moveToFirst()) return c.getString(0);
        } catch (Exception ignored) { }
        return null;
    }

    private long querySize(Uri uri) {
        try (Cursor c = getContext().getContentResolver().query(uri, new String[]{OpenableColumns.SIZE}, null, null, null)) {
            if (c != null && c.moveToFirst() && !c.isNull(0)) return c.getLong(0);
        } catch (Exception ignored) { }
        return -1;
    }
}
