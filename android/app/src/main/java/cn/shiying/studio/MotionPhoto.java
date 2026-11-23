package cn.shiying.studio;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import java.io.*;
import java.nio.charset.StandardCharsets;

final class MotionPhoto {
    interface Check { void run() throws IOException; }

    private static byte[] metadata(long videoLength) {
        String xmp = "http://ns.adobe.com/xap/1.0/\0"
                + "<x:xmpmeta xmlns:x=\"adobe:ns:meta/\">"
                + "<rdf:RDF xmlns:rdf=\"http://www.w3.org/1999/02/22-rdf-syntax-ns#\">"
                + "<rdf:Description rdf:about=\"\" xmlns:Camera=\"http://ns.google.com/photos/1.0/camera/\""
                + " xmlns:Container=\"http://ns.google.com/photos/1.0/container/\""
                + " xmlns:Item=\"http://ns.google.com/photos/1.0/container/item/\""
                + " Camera:MotionPhoto=\"1\" Camera:MotionPhotoVersion=\"1\" Camera:MotionPhotoPresentationTimestampUs=\"-1\">"
                + "<Container:Directory><rdf:Seq>"
                + "<rdf:li rdf:parseType=\"Resource\"><Container:Item Item:Mime=\"image/jpeg\" Item:Semantic=\"Primary\"/></rdf:li>"
                + "<rdf:li rdf:parseType=\"Resource\"><Container:Item Item:Mime=\"video/mp4\" Item:Semantic=\"MotionPhoto\" Item:Length=\""
                + videoLength + "\"/></rdf:li></rdf:Seq></Container:Directory></rdf:Description></rdf:RDF></x:xmpmeta>";
        return xmp.getBytes(StandardCharsets.UTF_8);
    }

    static void write(File image, File video, File target, Check check) throws IOException {
        check.run();
        try (RandomAccessFile clip = new RandomAccessFile(video, "r")) {
            if (clip.length() < 16 || clip.readInt() < 8 || clip.readInt() != 0x66747970) {
                throw new IOException("实况短片不是有效的 MP4");
            }
        }
        File jpeg = image;
        try (RandomAccessFile still = new RandomAccessFile(image, "r")) {
            boolean isJpeg = still.length() >= 4 && still.readUnsignedShort() == 0xffd8;
            if (isJpeg) {
                still.seek(still.length() - 2);
                isJpeg = still.readUnsignedShort() == 0xffd9;
            }
            if (!isJpeg) {
                jpeg = File.createTempFile("motion-still-", ".jpg", target.getParentFile());
                transcode(image, jpeg);
            }
            try (DataInputStream in = new DataInputStream(new BufferedInputStream(new FileInputStream(jpeg)));
                 DataOutputStream out = new DataOutputStream(new BufferedOutputStream(new FileOutputStream(target)));
                 InputStream clip = new BufferedInputStream(new FileInputStream(video))) {
                if (in.readUnsignedShort() != 0xffd8) throw new IOException("无法读取实况图片");
                byte[] xmp = metadata(video.length());
                out.writeShort(0xffd8);
                out.writeShort(0xffe1);
                out.writeShort(xmp.length + 2);
                out.write(xmp);
                copy(in, out, check);
                copy(clip, out, check);
            }
        } finally {
            if (!jpeg.equals(image)) jpeg.delete();
        }
    }

    private static void transcode(File image, File jpeg) throws IOException {
        BitmapFactory.Options options = new BitmapFactory.Options();
        options.inJustDecodeBounds = true;
        BitmapFactory.decodeFile(image.getPath(), options);
        if (options.outWidth <= 0 || options.outHeight <= 0) throw new IOException("无法读取实况图片");
        options.inSampleSize = 1;
        while ((long)(options.outWidth / options.inSampleSize) * (options.outHeight / options.inSampleSize) > 16000000) {
            options.inSampleSize *= 2;
        }
        options.inJustDecodeBounds = false;
        Bitmap bitmap = BitmapFactory.decodeFile(image.getPath(), options);
        if (bitmap == null) throw new IOException("无法读取实况图片");
        try (OutputStream out = new BufferedOutputStream(new FileOutputStream(jpeg))) {
            if (!bitmap.compress(Bitmap.CompressFormat.JPEG, 96, out)) throw new IOException("无法生成实况图片");
        } finally {
            bitmap.recycle();
        }
    }

    private static void copy(InputStream in, OutputStream out, Check check) throws IOException {
        byte[] buffer = new byte[65536];
        int length;
        while ((length = in.read(buffer)) != -1) {
            check.run();
            out.write(buffer, 0, length);
        }
        check.run();
    }
}
