import * as ImagePicker from "expo-image-picker";
import { File as ExpoFile, UploadType } from "expo-file-system";
import { useVideoPlayer, VideoView } from "expo-video";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  Share,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { apiRequest, apiUrl, errorMessage, isRecord } from "./api";

const maximumVideoBytes = 100 * 1024 * 1024;
const pageSize = 20;

interface VideoClip {
  id: string;
  caption: string;
  mimeType: string;
  createdAt: string;
  streamPath: string;
}

interface VideoPage {
  videos: VideoClip[];
  hasMore: boolean;
}

type VideoReaction = "like" | "dislike" | null;

interface VideoSocial {
  likeCount: number;
  dislikeCount: number;
  commentCount: number;
  shareCount: number;
  myReaction: VideoReaction;
}

interface VideoComment {
  id: string;
  text: string;
  authorSchool: string;
  createdAt: string;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function parseVideoSocial(value: unknown): VideoSocial {
  if (
    !isRecord(value) ||
    !isNonNegativeSafeInteger(value.likeCount) ||
    !isNonNegativeSafeInteger(value.dislikeCount) ||
    !isNonNegativeSafeInteger(value.commentCount) ||
    !isNonNegativeSafeInteger(value.shareCount) ||
    (value.myReaction !== null && value.myReaction !== "like" && value.myReaction !== "dislike")
  ) {
    throw new Error("The API returned invalid video activity.");
  }
  return {
    likeCount: value.likeCount,
    dislikeCount: value.dislikeCount,
    commentCount: value.commentCount,
    shareCount: value.shareCount,
    myReaction: value.myReaction,
  };
}

function parseVideoComment(value: unknown): VideoComment {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.text !== "string" ||
    typeof value.authorSchool !== "string" ||
    typeof value.createdAt !== "string"
  ) {
    throw new Error("The API returned an invalid comment.");
  }
  return {
    id: value.id,
    text: value.text,
    authorSchool: value.authorSchool,
    createdAt: value.createdAt,
  };
}

function parseVideoComments(value: unknown): VideoComment[] {
  if (!isRecord(value) || !Array.isArray(value.comments)) {
    throw new Error("The API returned an invalid comments response.");
  }
  return value.comments.map(parseVideoComment);
}

function parseVideoPage(value: unknown): VideoPage {
  if (!isRecord(value) || !Array.isArray(value.videos) || typeof value.hasMore !== "boolean") {
    throw new Error("The API returned an invalid video feed.");
  }

  const videos = value.videos.map((item): VideoClip => {
    if (
      !isRecord(item) ||
      typeof item.id !== "string" ||
      typeof item.caption !== "string" ||
      typeof item.mimeType !== "string" ||
      typeof item.createdAt !== "string" ||
      typeof item.streamPath !== "string"
    ) {
      throw new Error("The API returned an invalid video.");
    }
    return {
      id: item.id,
      caption: item.caption,
      mimeType: item.mimeType,
      createdAt: item.createdAt,
      streamPath: item.streamPath,
    };
  });
  return { videos, hasMore: value.hasMore };
}

interface VideoFeedScreenProps {
  token: string;
}

export default function VideoFeedScreen({ token }: VideoFeedScreenProps) {
  const [videos, setVideos] = useState<VideoClip[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [feedHeight, setFeedHeight] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [caption, setCaption] = useState("");
  const [error, setError] = useState("");
  const [uploadError, setUploadError] = useState("");
  const offset = useRef(0);
  const requestInFlight = useRef(false);
  const listRef = useRef<FlatList<VideoClip>>(null);

  const loadVideos = useCallback(
    async (reset: boolean): Promise<void> => {
      if (requestInFlight.current) {
        return;
      }
      requestInFlight.current = true;
      if (reset) {
        offset.current = 0;
        setIsLoading(true);
      }
      setError("");

      try {
        const page = parseVideoPage(
          await apiRequest(`/api/videos?offset=${offset.current}`, { token }),
        );
        setVideos((current) => (reset ? page.videos : [...current, ...page.videos]));
        offset.current += page.videos.length;
        setHasMore(page.hasMore);
        if (reset) {
          setActiveIndex(0);
          listRef.current?.scrollToOffset({ offset: 0, animated: false });
        }
      } catch (loadError) {
        setError(errorMessage(loadError));
      } finally {
        requestInFlight.current = false;
        setIsLoading(false);
        setIsRefreshing(false);
      }
    },
    [token],
  );

  useEffect(() => {
    void loadVideos(true);
  }, [loadVideos]);

  async function uploadVideo(): Promise<void> {
    setUploadError("");
    setUploadProgress(null);
    setIsUploading(true);
    try {
      const selection = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["videos"],
        allowsEditing: false,
        quality: 1,
        videoMaxDuration: 60,
      });
      if (selection.canceled) {
        return;
      }

      const asset = selection.assets[0];
      if (!asset) {
        throw new Error("No video was selected.");
      }
      if (asset.fileSize !== undefined && asset.fileSize > maximumVideoBytes) {
        throw new Error("Choose a video that is 100 MB or smaller.");
      }

      const mimeType =
        asset.mimeType ??
        (asset.fileName?.toLowerCase().endsWith(".mov") ? "video/quicktime" : "video/mp4");
      if (!["video/mp4", "video/quicktime", "video/x-m4v"].includes(mimeType)) {
        throw new Error("Choose an MP4 or MOV video.");
      }
      const videoFile = new ExpoFile(asset.uri);
      const uploadTask = videoFile.createUploadTask(`${apiUrl}/api/videos`, {
        uploadType: UploadType.MULTIPART,
        fieldName: "video",
        headers: { Authorization: `Bearer ${token}` },
        mimeType,
        parameters: { caption: caption.trim() },
        onProgress: ({ bytesSent, totalBytes }) => {
          const sent = Number(bytesSent);
          const total = Number(totalBytes);
          setUploadProgress(
            Number.isFinite(sent) && Number.isFinite(total) && total > 0
              ? Math.min(sent / total, 1)
              : null,
          );
        },
      });
      const response = await uploadTask.uploadAsync();
      const payload: unknown = JSON.parse(response.body);
      if (response.status < 200 || response.status >= 300) {
        const message =
          isRecord(payload) && typeof payload.error === "string"
            ? payload.error
            : `The upload failed (${response.status}).`;
        throw new Error(message);
      }
      setCaption("");
      setIsUploadOpen(false);
      setIsRefreshing(true);
      await loadVideos(true);
    } catch (uploadFailure) {
      setUploadError(errorMessage(uploadFailure));
    } finally {
      setIsUploading(false);
    }
  }

  const openUpload = (): void => {
    setUploadError("");
    setIsUploadOpen(true);
  };

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <View>
          <Text style={styles.wordmark}>MATROOM</Text>
          <Text style={styles.feedTitle}>For you</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          onPress={openUpload}
          style={styles.uploadButton}
        >
          <Text style={styles.uploadButtonText}>+ Upload</Text>
        </Pressable>
      </View>

      {isLoading && videos.length === 0 ? (
        <View style={styles.centerMessage}>
          <ActivityIndicator color="#f3a64a" />
          <Text style={styles.messageText}>Loading videos...</Text>
        </View>
      ) : error && videos.length === 0 ? (
        <View style={styles.centerMessage}>
          <Text style={styles.messageTitle}>Could not load the feed</Text>
          <Text style={styles.messageText}>{error}</Text>
          <Pressable style={styles.retryButton} onPress={() => void loadVideos(true)}>
            <Text style={styles.retryText}>Try again</Text>
          </Pressable>
        </View>
      ) : videos.length === 0 ? (
        <View style={styles.centerMessage}>
          <Text style={styles.messageTitle}>The mat is yours</Text>
          <Text style={styles.messageText}>
            No clips yet. Upload a wrestling video to start the feed.
          </Text>
          <Pressable style={styles.retryButton} onPress={openUpload}>
            <Text style={styles.retryText}>Upload your first clip</Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.listContainer} onLayout={(event) => setFeedHeight(event.nativeEvent.layout.height)}>
          <FlatList
            ref={listRef}
            data={videos}
            keyExtractor={(item) => item.id}
            renderItem={({ item, index }) => (
              <VideoFeedItem
                clip={item}
                token={token}
                active={index === activeIndex}
                height={feedHeight}
              />
            )}
            getItemLayout={
              feedHeight > 0
                ? (_data, index) => ({
                    length: feedHeight,
                    offset: feedHeight * index,
                    index,
                  })
                : undefined
            }
            pagingEnabled
            onMomentumScrollEnd={(event) => {
              if (feedHeight > 0) {
                setActiveIndex(Math.round(event.nativeEvent.contentOffset.y / feedHeight));
              }
            }}
            onEndReached={() => {
              if (hasMore && !requestInFlight.current) {
                setIsRefreshing(true);
                void loadVideos(false);
              }
            }}
            onEndReachedThreshold={0.75}
            windowSize={3}
            maxToRenderPerBatch={2}
            initialNumToRender={1}
            ListFooterComponent={
              isRefreshing ? (
                <ActivityIndicator style={styles.listLoading} color="#f3a64a" />
              ) : undefined
            }
          />
        </View>
      )}

      <Modal
        visible={isUploadOpen}
        transparent
        animationType="slide"
        onRequestClose={() => {
          if (!isUploading) {
            setIsUploadOpen(false);
          }
        }}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Share a wrestling clip</Text>
            <Text style={styles.modalDescription}>
              Choose a video up to 60 seconds and 100 MB.
            </Text>
            <TextInput
              value={caption}
              onChangeText={setCaption}
              maxLength={280}
              placeholder="Add a caption (optional)"
              placeholderTextColor="#71777b"
              style={styles.captionInput}
              multiline
            />
            {uploadError ? <Text style={styles.errorText}>{uploadError}</Text> : null}
            <Pressable
              accessibilityRole="button"
              disabled={isUploading}
              onPress={() => void uploadVideo()}
              style={[styles.uploadButton, isUploading && styles.disabledButton]}
            >
              <Text style={styles.uploadButtonText}>
                {isUploading
                  ? uploadProgress === null
                    ? "Uploading..."
                    : `Uploading ${Math.round(uploadProgress * 100)}%`
                  : "Choose video"}
              </Text>
            </Pressable>
            <Pressable
              disabled={isUploading}
              onPress={() => setIsUploadOpen(false)}
              style={styles.cancelButton}
            >
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

interface VideoFeedItemProps {
  clip: VideoClip;
  token: string;
  active: boolean;
  height: number;
}

function VideoFeedItem({ clip, token, active, height }: VideoFeedItemProps) {
  const [muted, setMuted] = useState(true);
  const [social, setSocial] = useState<VideoSocial | null>(null);
  const [socialError, setSocialError] = useState("");
  const [isUpdatingReaction, setIsUpdatingReaction] = useState(false);
  const [isCommentsOpen, setIsCommentsOpen] = useState(false);
  const [comments, setComments] = useState<VideoComment[]>([]);
  const [areCommentsLoading, setAreCommentsLoading] = useState(false);
  const [commentError, setCommentError] = useState("");
  const [commentDraft, setCommentDraft] = useState("");
  const [isSubmittingComment, setIsSubmittingComment] = useState(false);
  const source = useMemo(
    () => ({
      uri: `${apiUrl}${clip.streamPath}`,
      headers: { Authorization: `Bearer ${token}` },
    }),
    [clip.streamPath, token],
  );
  const loadSocial = useCallback(async (): Promise<void> => {
    try {
      const stats = parseVideoSocial(
        await apiRequest(`/api/videos/${clip.id}/social`, { token }),
      );
      setSocial(stats);
      setSocialError("");
    } catch (loadError) {
      setSocialError(errorMessage(loadError));
    }
  }, [clip.id, token]);
  const loadComments = useCallback(async (): Promise<void> => {
    setAreCommentsLoading(true);
    setCommentError("");
    try {
      setComments(
        parseVideoComments(await apiRequest(`/api/videos/${clip.id}/comments`, { token })),
      );
    } catch (loadError) {
      setCommentError(errorMessage(loadError));
    } finally {
      setAreCommentsLoading(false);
    }
  }, [clip.id, token]);
  const player = useVideoPlayer(source, (videoPlayer) => {
    videoPlayer.loop = true;
    videoPlayer.muted = true;
  });

  useEffect(() => {
    void loadSocial();
  }, [loadSocial]);

  useEffect(() => {
    if (active) {
      player.play();
    } else {
      player.pause();
    }
  }, [active, player]);

  function toggleMuted(): void {
    player.muted = !muted;
    setMuted(!muted);
  }

  async function updateReaction(reaction: Exclude<VideoReaction, null>): Promise<void> {
    if (!social || isUpdatingReaction) {
      return;
    }

    setIsUpdatingReaction(true);
    setSocialError("");
    try {
      const nextReaction = social.myReaction === reaction ? null : reaction;
      setSocial(
        parseVideoSocial(
          await apiRequest(`/api/videos/${clip.id}/reaction`, {
            token,
            method: "PUT",
            body: { reaction: nextReaction },
          }),
        ),
      );
    } catch (reactionError) {
      setSocialError(errorMessage(reactionError));
    } finally {
      setIsUpdatingReaction(false);
    }
  }

  function openComments(): void {
    setIsCommentsOpen(true);
    void loadComments();
    void loadSocial();
  }

  async function submitComment(): Promise<void> {
    const text = commentDraft.trim();
    if (!text || isSubmittingComment) {
      return;
    }

    setIsSubmittingComment(true);
    setCommentError("");
    try {
      const response = await apiRequest(`/api/videos/${clip.id}/comments`, {
        token,
        method: "POST",
        body: { text },
      });
      if (!isRecord(response) || !("comment" in response)) {
        throw new Error("The API returned an invalid comment response.");
      }
      setComments((currentComments) => [
        ...currentComments,
        parseVideoComment(response.comment),
      ]);
      setCommentDraft("");
      await loadSocial();
    } catch (submitError) {
      setCommentError(errorMessage(submitError));
    } finally {
      setIsSubmittingComment(false);
    }
  }

  async function shareVideo(): Promise<void> {
    try {
      const result = await Share.share({
        message: [
          "Watch this wrestling clip on Matroom:",
          clip.caption || "A wrestling moment",
          `Video ID: ${clip.id}`,
        ].join("\n\n"),
      });
      if (result.action !== Share.sharedAction) {
        return;
      }

      await apiRequest(`/api/videos/${clip.id}/shares`, {
        token,
        method: "POST",
      });
      await loadSocial();
    } catch (shareError) {
      setSocialError(errorMessage(shareError));
    }
  }

  return (
    <View style={[styles.videoItem, { height }]}>
      <VideoView
        player={player}
        style={StyleSheet.absoluteFill}
        contentFit="cover"
        nativeControls={false}
      />
      <View style={styles.videoOverlay}>
        <View style={styles.clipDetails}>
          <Text style={styles.clipAuthor}>MATROOM WRESTLING</Text>
          <Text style={styles.clipCaption}>
            {clip.caption || "A wrestling moment"}
          </Text>
          <Text style={styles.clipDate}>
            {new Date(clip.createdAt).toLocaleDateString()}
          </Text>
          {socialError ? <Text style={styles.socialError}>{socialError}</Text> : null}
        </View>
        <View style={styles.socialRail}>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ selected: social?.myReaction === "like" }}
            disabled={!social || isUpdatingReaction}
            onPress={() => void updateReaction("like")}
            style={styles.socialButton}
          >
            <Text
              style={[
                styles.socialLabel,
                social?.myReaction === "like" && styles.socialLabelActive,
              ]}
            >
              Like
            </Text>
            <Text style={styles.socialCount}>{social?.likeCount ?? 0}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ selected: social?.myReaction === "dislike" }}
            disabled={!social || isUpdatingReaction}
            onPress={() => void updateReaction("dislike")}
            style={styles.socialButton}
          >
            <Text
              style={[
                styles.socialLabel,
                social?.myReaction === "dislike" && styles.socialLabelActive,
              ]}
            >
              Dislike
            </Text>
            <Text style={styles.socialCount}>{social?.dislikeCount ?? 0}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${social?.commentCount ?? 0} comments`}
            onPress={openComments}
            style={styles.socialButton}
          >
            <Text style={styles.socialLabel}>Comments</Text>
            <Text style={styles.socialCount}>{social?.commentCount ?? 0}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={() => void shareVideo()}
            style={styles.socialButton}
          >
            <Text style={styles.socialLabel}>Share</Text>
            <Text style={styles.socialCount}>{social?.shareCount ?? 0}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={muted ? "Turn sound on" : "Mute video"}
            onPress={toggleMuted}
            style={styles.soundButton}
          >
            <Text style={styles.soundButtonText}>{muted ? "Sound off" : "Sound on"}</Text>
          </Pressable>
        </View>
      </View>
      <Modal
        visible={isCommentsOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setIsCommentsOpen(false)}
      >
        <View style={styles.commentsBackdrop}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close comments"
            onPress={() => setIsCommentsOpen(false)}
            style={StyleSheet.absoluteFill}
          />
          <View style={styles.commentsSheet}>
            <View style={styles.commentsHeader}>
              <Text style={styles.commentsTitle}>
                Comments ({social?.commentCount ?? comments.length})
              </Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => setIsCommentsOpen(false)}
                style={styles.commentsCloseButton}
              >
                <Text style={styles.commentsCloseText}>Close</Text>
              </Pressable>
            </View>
            {areCommentsLoading ? (
              <ActivityIndicator color="#f3a64a" />
            ) : commentError ? (
              <View style={styles.commentsStatus}>
                <Text style={styles.socialError}>{commentError}</Text>
                <Pressable onPress={() => void loadComments()}>
                  <Text style={styles.commentsCloseText}>Try again</Text>
                </Pressable>
              </View>
            ) : comments.length === 0 ? (
              <View style={styles.commentsStatus}>
                <Text style={styles.modalDescription}>No comments yet. Start the conversation.</Text>
              </View>
            ) : (
              <ScrollView
                style={styles.commentsList}
                contentContainerStyle={styles.commentsListContent}
                keyboardShouldPersistTaps="handled"
              >
                {comments.map((comment) => (
                  <View key={comment.id} style={styles.commentItem}>
                    <View style={styles.commentMetadata}>
                      <Text style={styles.commentAuthor}>{comment.authorSchool}</Text>
                      <Text style={styles.commentDate}>
                        {new Date(comment.createdAt).toLocaleDateString()}
                      </Text>
                    </View>
                    <Text style={styles.commentText}>{comment.text}</Text>
                  </View>
                ))}
              </ScrollView>
            )}
            <View style={styles.commentComposer}>
              <TextInput
                value={commentDraft}
                onChangeText={setCommentDraft}
                maxLength={500}
                placeholder="Add a comment..."
                placeholderTextColor="#71777b"
                style={styles.commentInput}
                multiline
              />
              <Pressable
                accessibilityRole="button"
                disabled={!commentDraft.trim() || isSubmittingComment}
                onPress={() => void submitComment()}
                style={[
                  styles.commentSubmitButton,
                  (!commentDraft.trim() || isSubmittingComment) && styles.disabledButton,
                ]}
              >
                <Text style={styles.commentSubmitText}>
                  {isSubmittingComment ? "Posting..." : "Post"}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#101214",
  },
  header: {
    minHeight: 64,
    paddingHorizontal: 20,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderBottomWidth: 1,
    borderBottomColor: "#25292c",
  },
  wordmark: {
    color: "#f4f4f1",
    fontSize: 14,
    fontWeight: "900",
    letterSpacing: 1.8,
  },
  feedTitle: {
    color: "#9b9fa3",
    fontSize: 12,
    marginTop: 2,
  },
  uploadButton: {
    minHeight: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 10,
    backgroundColor: "#f3a64a",
    paddingHorizontal: 15,
  },
  uploadButtonText: {
    color: "#151515",
    fontSize: 14,
    fontWeight: "800",
  },
  listContainer: {
    flex: 1,
  },
  videoItem: {
    width: "100%",
    backgroundColor: "#080909",
    overflow: "hidden",
  },
  videoOverlay: {
    ...StyleSheet.absoluteFill,
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingBottom: 24,
  },
  clipDetails: {
    maxWidth: "72%",
    gap: 6,
  },
  clipAuthor: {
    color: "#f3a64a",
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 1,
  },
  clipCaption: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "700",
    textShadowColor: "#000000",
    textShadowRadius: 4,
  },
  clipDate: {
    color: "#e0e0e0",
    fontSize: 11,
  },
  socialRail: {
    alignItems: "center",
    gap: 14,
    paddingBottom: 4,
  },
  socialButton: {
    minWidth: 58,
    alignItems: "center",
    gap: 2,
  },
  socialLabel: {
    color: "#ffffff",
    fontSize: 12,
    fontWeight: "800",
    textShadowColor: "#000000",
    textShadowRadius: 4,
  },
  socialLabelActive: {
    color: "#f3a64a",
  },
  socialCount: {
    color: "#ffffff",
    fontSize: 12,
    fontWeight: "700",
    textShadowColor: "#000000",
    textShadowRadius: 4,
  },
  socialError: {
    color: "#ff8b82",
    fontSize: 12,
    textShadowColor: "#000000",
    textShadowRadius: 4,
  },
  soundButton: {
    borderRadius: 16,
    backgroundColor: "#101214bb",
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  soundButtonText: {
    color: "#ffffff",
    fontSize: 12,
    fontWeight: "700",
  },
  centerMessage: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 28,
    gap: 14,
  },
  messageTitle: {
    color: "#f4f4f1",
    fontSize: 22,
    fontWeight: "800",
    textAlign: "center",
  },
  messageText: {
    color: "#b1b5b8",
    fontSize: 14,
    lineHeight: 21,
    textAlign: "center",
  },
  retryButton: {
    marginTop: 8,
    borderRadius: 10,
    backgroundColor: "#f3a64a",
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  retryText: {
    color: "#151515",
    fontSize: 14,
    fontWeight: "800",
  },
  listLoading: {
    padding: 16,
  },
  modalBackdrop: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "#00000099",
  },
  modalCard: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    backgroundColor: "#191c1f",
    padding: 24,
    gap: 16,
  },
  modalTitle: {
    color: "#f4f4f1",
    fontSize: 21,
    fontWeight: "800",
  },
  modalDescription: {
    color: "#b1b5b8",
    fontSize: 14,
  },
  commentsBackdrop: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "#00000099",
  },
  commentsSheet: {
    height: "72%",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    backgroundColor: "#191c1f",
    padding: 20,
    gap: 14,
  },
  commentsHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  commentsTitle: {
    color: "#f4f4f1",
    fontSize: 20,
    fontWeight: "800",
  },
  commentsCloseButton: {
    padding: 8,
  },
  commentsCloseText: {
    color: "#f3a64a",
    fontSize: 14,
    fontWeight: "700",
  },
  commentsStatus: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  commentsList: {
    flex: 1,
  },
  commentsListContent: {
    gap: 16,
    paddingVertical: 6,
  },
  commentItem: {
    gap: 6,
  },
  commentMetadata: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  commentAuthor: {
    color: "#f3a64a",
    fontSize: 13,
    fontWeight: "800",
  },
  commentDate: {
    color: "#8e9397",
    fontSize: 11,
  },
  commentText: {
    color: "#f4f4f1",
    fontSize: 14,
    lineHeight: 20,
  },
  commentComposer: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 10,
  },
  commentInput: {
    flex: 1,
    minHeight: 44,
    maxHeight: 100,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#3a3f43",
    backgroundColor: "#101214",
    color: "#f4f4f1",
    paddingHorizontal: 12,
    paddingVertical: 10,
    textAlignVertical: "top",
  },
  commentSubmitButton: {
    minHeight: 44,
    justifyContent: "center",
    borderRadius: 10,
    backgroundColor: "#f3a64a",
    paddingHorizontal: 14,
  },
  commentSubmitText: {
    color: "#151515",
    fontSize: 14,
    fontWeight: "800",
  },
  captionInput: {
    minHeight: 72,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#3a3f43",
    backgroundColor: "#101214",
    color: "#f4f4f1",
    padding: 12,
    textAlignVertical: "top",
  },
  errorText: {
    color: "#ff8b82",
    fontSize: 13,
  },
  disabledButton: {
    opacity: 0.6,
  },
  cancelButton: {
    alignItems: "center",
    paddingVertical: 8,
  },
  cancelText: {
    color: "#f3a64a",
    fontSize: 14,
    fontWeight: "700",
  },
});
