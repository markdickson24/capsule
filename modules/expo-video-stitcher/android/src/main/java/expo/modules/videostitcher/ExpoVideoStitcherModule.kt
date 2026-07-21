package expo.modules.videostitcher

import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaMuxer
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import java.io.File
import java.nio.ByteBuffer
import java.util.UUID

class ExpoVideoStitcherModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ExpoVideoStitcher")

    AsyncFunction("stitchVideos") { uris: List<String>, promise: Promise ->
      CoroutineScope(Dispatchers.IO).launch {
        try {
          val outputPath = stitch(uris)
          promise.resolve(mapOf("uri" to "file://$outputPath"))
        } catch (e: Exception) {
          promise.reject("STITCH_FAILED", e.message ?: "Stitching failed", e)
        }
      }
    }

    // Trims a video to its first `maxSeconds` seconds, writing a NEW temp
    // file (the source is never modified). Resolves { uri } like stitchVideos.
    AsyncFunction("trimVideo") { uri: String, maxSeconds: Double, promise: Promise ->
      CoroutineScope(Dispatchers.IO).launch {
        try {
          val outputPath = trim(uri, maxSeconds)
          promise.resolve(mapOf("uri" to "file://$outputPath"))
        } catch (e: Exception) {
          promise.reject("TRIM_FAILED", e.message ?: "Trim failed", e)
        }
      }
    }
  }

  private fun stitch(uris: List<String>): String {
    val cacheDir = appContext.reactContext?.cacheDir
      ?: throw Exception("No Android context available")
    val outputFile = File(cacheDir, "${UUID.randomUUID()}.mp4")

    val muxer = MediaMuxer(
      outputFile.absolutePath,
      MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4
    )

    // Phase 1: Add tracks from the first segment so we can start the muxer.
    // All segments are from the same camera so codec settings match.
    val firstPath = uris.first().toFsPath()
    val setupExtractor = MediaExtractor()
    setupExtractor.setDataSource(firstPath)

    var muxerVideoTrack = -1
    var muxerAudioTrack = -1

    for (i in 0 until setupExtractor.trackCount) {
      val fmt = setupExtractor.getTrackFormat(i)
      val mime = fmt.getString(MediaFormat.KEY_MIME) ?: continue
      when {
        mime.startsWith("video/") && muxerVideoTrack < 0 ->
          muxerVideoTrack = muxer.addTrack(fmt)
        mime.startsWith("audio/") && muxerAudioTrack < 0 ->
          muxerAudioTrack = muxer.addTrack(fmt)
      }
    }
    setupExtractor.release()

    muxer.start()

    // Phase 2: Write each segment's tracks, adjusting PTS by running offset.
    var videoOffset = 0L
    var audioOffset = 0L

    for (uri in uris) {
      val path = uri.toFsPath()

      if (muxerVideoTrack >= 0) {
        val ext = MediaExtractor()
        ext.setDataSource(path)
        val track = ext.findTrack("video/")
        if (track >= 0) {
          ext.selectTrack(track)
          val fmt = ext.getTrackFormat(track)
          val buf = ByteBuffer.allocate(1 * 1024 * 1024)
          val info = MediaCodec.BufferInfo()
          var lastPts = 0L

          while (true) {
            info.offset = 0
            info.size = ext.readSampleData(buf, 0)
            if (info.size < 0) break
            info.presentationTimeUs = ext.sampleTime + videoOffset
            info.flags = ext.sampleFlags
            lastPts = ext.sampleTime
            muxer.writeSampleData(muxerVideoTrack, buf, info)
            ext.advance()
          }

          videoOffset += segmentDuration(fmt, lastPts)
        }
        ext.release()
      }

      if (muxerAudioTrack >= 0) {
        val ext = MediaExtractor()
        ext.setDataSource(path)
        val track = ext.findTrack("audio/")
        if (track >= 0) {
          ext.selectTrack(track)
          val fmt = ext.getTrackFormat(track)
          val buf = ByteBuffer.allocate(512 * 1024)
          val info = MediaCodec.BufferInfo()
          var lastPts = 0L

          while (true) {
            info.offset = 0
            info.size = ext.readSampleData(buf, 0)
            if (info.size < 0) break
            info.presentationTimeUs = ext.sampleTime + audioOffset
            info.flags = ext.sampleFlags
            lastPts = ext.sampleTime
            muxer.writeSampleData(muxerAudioTrack, buf, info)
            ext.advance()
          }

          audioOffset += segmentDuration(fmt, lastPts)
        }
        ext.release()
      }
    }

    muxer.stop()
    muxer.release()

    return outputFile.absolutePath
  }

  // Trims the source at `uri` to its first `maxSeconds` seconds and writes a
  // NEW temp MP4 (the source file is untouched). Mirrors stitch()'s
  // MediaExtractor/MediaMuxer plumbing (cache-dir temp file, track add,
  // read/write sample loop) but for a single input, cut at a time bound
  // instead of concatenated across multiple inputs.
  private fun trim(uri: String, maxSeconds: Double): String {
    val cacheDir = appContext.reactContext?.cacheDir
      ?: throw Exception("No Android context available")
    val outputFile = File(cacheDir, "${UUID.randomUUID()}.mp4")
    val path = uri.toFsPath()
    val maxSampleTimeUs = (maxSeconds * 1_000_000).toLong()

    val muxer = MediaMuxer(
      outputFile.absolutePath,
      MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4
    )
    var muxerStarted = false

    try {
      // Phase 1: Add all tracks (video + audio) so we can start the muxer.
      var muxerVideoTrack = -1
      var muxerAudioTrack = -1
      val setupExtractor = MediaExtractor()
      try {
        setupExtractor.setDataSource(path)
        for (i in 0 until setupExtractor.trackCount) {
          val fmt = setupExtractor.getTrackFormat(i)
          val mime = fmt.getString(MediaFormat.KEY_MIME) ?: continue
          when {
            mime.startsWith("video/") && muxerVideoTrack < 0 ->
              muxerVideoTrack = muxer.addTrack(fmt)
            mime.startsWith("audio/") && muxerAudioTrack < 0 ->
              muxerAudioTrack = muxer.addTrack(fmt)
          }
        }
      } finally {
        setupExtractor.release()
      }

      if (muxerVideoTrack < 0 && muxerAudioTrack < 0) {
        throw Exception("No video/audio tracks found to trim")
      }

      muxer.start()
      muxerStarted = true

      // Phase 2: For each track present, re-open a FRESH MediaExtractor and
      // re-derive its track index via findTrack() on THAT instance — mirrors
      // stitch()'s per-instance mime lookup rather than assuming track
      // enumeration order is stable across separate MediaExtractor instances
      // opened on the same file. Seeks to 0 and copies samples until the
      // time bound is exceeded or the track is exhausted.
      if (muxerVideoTrack >= 0) {
        val ext = MediaExtractor()
        try {
          ext.setDataSource(path)
          val track = ext.findTrack("video/")
          if (track >= 0) {
            ext.selectTrack(track)
            ext.seekTo(0, MediaExtractor.SEEK_TO_CLOSEST_SYNC)

            val buf = ByteBuffer.allocate(1 * 1024 * 1024)
            val info = MediaCodec.BufferInfo()

            while (true) {
              val sampleTime = ext.sampleTime
              if (sampleTime < 0 || sampleTime > maxSampleTimeUs) break

              info.offset = 0
              info.size = ext.readSampleData(buf, 0)
              if (info.size < 0) break
              info.presentationTimeUs = sampleTime
              info.flags = ext.sampleFlags
              muxer.writeSampleData(muxerVideoTrack, buf, info)
              ext.advance()
            }
          }
        } finally {
          ext.release()
        }
      }

      if (muxerAudioTrack >= 0) {
        val ext = MediaExtractor()
        try {
          ext.setDataSource(path)
          val track = ext.findTrack("audio/")
          if (track >= 0) {
            ext.selectTrack(track)
            ext.seekTo(0, MediaExtractor.SEEK_TO_CLOSEST_SYNC)

            val buf = ByteBuffer.allocate(512 * 1024)
            val info = MediaCodec.BufferInfo()

            while (true) {
              val sampleTime = ext.sampleTime
              if (sampleTime < 0 || sampleTime > maxSampleTimeUs) break

              info.offset = 0
              info.size = ext.readSampleData(buf, 0)
              if (info.size < 0) break
              info.presentationTimeUs = sampleTime
              info.flags = ext.sampleFlags
              muxer.writeSampleData(muxerAudioTrack, buf, info)
              ext.advance()
            }
          }
        } finally {
          ext.release()
        }
      }
    } finally {
      // muxer.stop() can itself throw (e.g. no samples were ever written) —
      // guard it separately so that failure can't mask an exception already
      // propagating from the try block above. Only call stop() if start()
      // actually ran; muxer.release() always runs.
      if (muxerStarted) {
        try {
          muxer.stop()
        } catch (e: Exception) {
          // Best-effort cleanup only; the original exception (if any) wins.
        }
      }
      muxer.release()
    }

    return outputFile.absolutePath
  }

  private fun String.toFsPath(): String =
    if (startsWith("file://")) substring(7) else this

  private fun MediaExtractor.findTrack(mimePrefix: String): Int {
    for (i in 0 until trackCount) {
      val mime = getTrackFormat(i).getString(MediaFormat.KEY_MIME) ?: continue
      if (mime.startsWith(mimePrefix)) return i
    }
    return -1
  }

  // Returns the total duration of a segment, falling back to lastPts + one frame.
  private fun segmentDuration(format: MediaFormat, lastPts: Long): Long =
    if (format.containsKey(MediaFormat.KEY_DURATION)) format.getLong(MediaFormat.KEY_DURATION)
    else lastPts + 33_333L
}
