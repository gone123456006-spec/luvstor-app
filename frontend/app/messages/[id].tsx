import { Ionicons } from '@expo/vector-icons';
import { Audio } from 'expo-av';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system';
import { LinearGradient } from 'expo-linear-gradient';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { getCurrentAuthUser, getAuthToken } from '../../utils/auth';
import { apiRequest, API_BASE } from '../../utils/api';
import { useAuth } from '../../contexts/AuthContext';
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { GestureHandlerRootView, Swipeable } from 'react-native-gesture-handler';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { io, Socket } from 'socket.io-client';

const { width: screenWidth } = Dimensions.get('window');
const IMG_BUBBLE_WIDTH = Math.min(screenWidth * 0.70, 280);

const FALLBACK_BOY = require('../../assets/images/boy-image.png');
const FALLBACK_GIRL = require('../../assets/images/girls-image.png');

// ── Types ─────────────────────────────────────────────────────────
interface ChatMsg {
  _id: string;
  sender: 'me' | 'other';
  text: string;
  type: 'text' | 'image' | 'audio';
  mediaUrl?: string | null;
  localImageUri?: string;
  localVoiceUri?: string;
  replyTo?: ChatMsg;
  isDeleted?: boolean;
  createdAt: number;
  pending?: boolean;
}

// ── Helpers ───────────────────────────────────────────────────────
function fmtTime(ts: number) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// ── Voice bubble ──────────────────────────────────────────────────
const VoiceMessage = ({ uri, isMe, createdAt }: { uri: string; isMe: boolean; createdAt: number }) => {
  const [sound, setSound] = useState<Audio.Sound | null>(null);
  const [playing, setPlaying] = useState(false);

  async function toggle() {
    if (sound) {
      playing ? await sound.pauseAsync() : await sound.playAsync();
      setPlaying(p => !p);
    } else {
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false, playsInSilentModeIOS: true, shouldDuckAndroid: true, playThroughEarpieceAndroid: false });
      const { sound: s } = await Audio.Sound.createAsync({ uri }, { shouldPlay: true });
      setSound(s);
      setPlaying(true);
      s.setOnPlaybackStatusUpdate(st => { if (st.isLoaded && st.didJustFinish) { setPlaying(false); s.setPositionAsync(0); } });
    }
  }
  useEffect(() => () => { sound?.unloadAsync(); }, [sound]);

  return (
    <View style={[styles.bubbleWrapper, isMe ? styles.myBubbleWrapper : styles.otherBubbleWrapper]}>
      <LinearGradient colors={isMe ? ['#8E2DE2', '#8E2DE2'] : ['#F0F0F0', '#F0F0F0']}
        style={[styles.messageBubble, isMe ? styles.myBubbleBorder : styles.otherBubbleBorder, { width: 220 }]}>
        <View style={styles.voiceNoteContent}>
          <TouchableOpacity onPress={toggle} style={styles.playButton}>
            <Ionicons name={playing ? 'pause' : 'play'} size={24} color={isMe ? '#fff' : '#8E2DE2'} />
          </TouchableOpacity>
          <View style={styles.waveformContainer}>
            {[15, 25, 20, 30, 20, 25, 15].map((h, i) => (
              <View key={i} style={[styles.waveformBar, { height: h, backgroundColor: isMe ? 'rgba(255,255,255,0.5)' : '#ccc' }]} />
            ))}
          </View>
        </View>
        <View style={styles.timeWrapper}>
          <Text style={[styles.messageTime, isMe ? styles.myMessageTime : styles.otherMessageTime]}>{fmtTime(createdAt)}</Text>
          {isMe && <Ionicons name="checkmark-done" size={14} color="#4FC3F7" style={{ marginLeft: 4 }} />}
        </View>
      </LinearGradient>
      <View style={[styles.bubbleNotch, isMe ? styles.myNotch : styles.otherNotch, { borderTopColor: isMe ? '#8E2DE2' : '#F0F0F0' }]} />
    </View>
  );
};

// ── Message row ───────────────────────────────────────────────────
const MessageItem = ({
  item, onReply, onImagePress, onToggleSelect, isSelected, selectionMode, otherName,
}: {
  item: ChatMsg; onReply: (m: ChatMsg) => void; onImagePress: (uri: string) => void;
  onToggleSelect: (id: string) => void; isSelected: boolean; selectionMode: boolean; otherName: string;
}) => {
  const isMe = item.sender === 'me';
  const swRef = useRef<Swipeable>(null);

  const ReplyPreview = () => {
    if (!item.replyTo) return null;
    return (
      <View style={[styles.replyBubble, isMe ? styles.myReplyBubble : styles.otherReplyBubble]}>
        <Text style={[styles.replyBubbleName, isMe ? styles.myReplyBubbleName : styles.otherReplyBubbleName]}>
          {item.replyTo.sender === 'me' ? 'You' : otherName}
        </Text>
        <Text style={[styles.replyBubbleText, isMe ? styles.myReplyBubbleText : styles.otherReplyBubbleText]} numberOfLines={1}>
          {item.replyTo.text || (item.replyTo.localImageUri || item.replyTo.mediaUrl ? 'Photo' : 'Voice')}
        </Text>
      </View>
    );
  };

  if (item.isDeleted) {
    return (
      <View style={[styles.messageContainer, isMe ? styles.myMessage : styles.otherMessage]}>
        <View style={[styles.bubbleWrapper, isMe ? styles.myBubbleWrapper : styles.otherBubbleWrapper]}>
          <View style={[styles.messageBubble, styles.deletedBubbleBorder, isMe ? styles.myDeletedBubble : styles.otherDeletedBubble]}>
            <View style={styles.deletedMessageContent}>
              <Ionicons name="ban-outline" size={16} color={isMe ? 'rgba(255,255,255,0.7)' : '#999'} style={{ marginRight: 6 }} />
              <Text style={[styles.deletedMessageText, isMe ? styles.myDeletedMessageText : styles.otherDeletedMessageText]}>
                This message was deleted
              </Text>
            </View>
          </View>
          <View style={[styles.bubbleNotch, isMe ? styles.myNotch : styles.otherNotch, { borderTopColor: isMe ? 'rgba(142,45,226,0.4)' : '#F5F5F5' }]} />
        </View>
      </View>
    );
  }

  const imgUri = item.localImageUri || (item.type === 'image' ? item.mediaUrl : null);
  if (imgUri) {
    return (
      <View style={[styles.messageContainer, isMe ? styles.myMessage : styles.otherMessage]}>
        <View style={[styles.bubbleWrapper, isMe ? styles.myBubbleWrapper : styles.otherBubbleWrapper]}>
          <TouchableOpacity onPress={() => onImagePress(imgUri)} activeOpacity={0.85}
            style={[styles.imageBubble, isMe ? styles.myImageBubble : styles.otherImageBubble, { width: IMG_BUBBLE_WIDTH }]}>
            <View style={{ borderRadius: 16, overflow: 'hidden' }}>
              <ReplyPreview />
              <Image source={{ uri: imgUri }} style={{ width: IMG_BUBBLE_WIDTH, height: 200 }} contentFit="cover" />
              <View style={styles.imageTimeOverlay}>
                {isMe && <Ionicons name="checkmark-done" size={13} color="#4FC3F7" style={{ marginRight: 3 }} />}
                <Text style={[styles.messageTime, { color: '#fff' }]}>{fmtTime(item.createdAt)}</Text>
              </View>
            </View>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  const voiceUri = item.localVoiceUri || (item.type === 'audio' ? item.mediaUrl : null);
  if (voiceUri) {
    return (
      <View style={[styles.messageContainer, isMe ? styles.myMessage : styles.otherMessage]}>
        <VoiceMessage uri={voiceUri} isMe={isMe} createdAt={item.createdAt} />
      </View>
    );
  }

  const handleSwipe = (direction: string) => {
    // my messages swipe left (right action), other messages swipe right (left action)
    if ((isMe && direction === 'right') || (!isMe && direction === 'left')) {
      onReply(item);
      setTimeout(() => swRef.current?.close(), 50);
    }
  };

  return (
    <Swipeable
      ref={swRef}
      renderLeftActions={!isMe && !selectionMode ? () => (
        <View style={styles.replyActionContainer}><View style={styles.replyActionIcon}><Ionicons name="arrow-undo" size={20} color="#fff" /></View></View>
      ) : undefined}
      renderRightActions={isMe && !selectionMode ? () => (
        <View style={styles.replyActionContainer}><View style={styles.replyActionIcon}><Ionicons name="arrow-undo" size={20} color="#fff" /></View></View>
      ) : undefined}
      onSwipeableOpen={(direction) => handleSwipe(direction)}
      overshootLeft={false} overshootRight={false} friction={2}
    >
      <Pressable
        onLongPress={() => { if (!item.isDeleted && !selectionMode) onToggleSelect(item._id); }}
        onPress={selectionMode && !item.isDeleted ? () => onToggleSelect(item._id) : undefined}
        style={[styles.messageRow, isSelected && styles.selectedMessageRow]}
      >
        {selectionMode && !item.isDeleted && (
          <View style={styles.checkboxContainer}>
            <View style={[styles.checkbox, isSelected && styles.checkboxSelected]}>
              {isSelected && <Ionicons name="checkmark" size={14} color="#fff" />}
            </View>
          </View>
        )}
        <View pointerEvents={selectionMode ? 'none' : 'box-none'} style={{ flex: 1 }}>
          <View style={[styles.messageContainer, isMe ? styles.myMessage : styles.otherMessage]}>
            <View style={[styles.bubbleWrapper, isMe ? styles.myBubbleWrapper : styles.otherBubbleWrapper]}>
              <LinearGradient
                colors={isMe ? ['#8E2DE2', '#8E2DE2'] : ['#F0F0F0', '#F0F0F0']}
                style={[styles.messageBubble, isMe ? styles.myBubbleBorder : styles.otherBubbleBorder]}
                start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
              >
                <ReplyPreview />
                <View style={styles.messageContent}>
                  <Text style={[styles.messageText, isMe ? styles.myMessageText : styles.otherMessageText]}>
                    {item.text}
                  </Text>
                  <View style={styles.timeWrapper}>
                    <Text style={[styles.messageTime, isMe ? styles.myMessageTime : styles.otherMessageTime]}>
                      {fmtTime(item.createdAt)}
                    </Text>
                    {isMe && !item.pending && <Ionicons name="checkmark-done" size={14} color="#4FC3F7" style={{ marginLeft: 4 }} />}
                    {isMe && item.pending && <Ionicons name="checkmark" size={14} color="rgba(255,255,255,0.5)" style={{ marginLeft: 4 }} />}
                  </View>
                </View>
              </LinearGradient>
              <View style={[styles.bubbleNotch, isMe ? styles.myNotch : styles.otherNotch, { borderTopColor: isMe ? '#8E2DE2' : '#F0F0F0' }]} />
            </View>
          </View>
        </View>
      </Pressable>
    </Swipeable>
  );
};

// ── Main Screen ───────────────────────────────────────────────────
export default function MessageScreen() {
  const { id, name, photo, gender, isOnline: isOnlineParam } = useLocalSearchParams<{ id: string; name: string; photo: string; gender: string; isOnline: string }>();
  const router = useRouter();
  const { sessionVersion } = useAuth();

  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [loading, setLoading] = useState(true);
  const [inputText, setInputText] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [selectedImage, setSelectedImage] = useState<{ uri: string; width: number; height: number } | null>(null);
  const [fullScreenImage, setFullScreenImage] = useState<string | null>(null);
  const [replyingTo, setReplyingTo] = useState<ChatMsg | null>(null);
  const [selectedMessages, setSelectedMessages] = useState<string[]>([]);

  const [otherUserOnline, setOtherUserOnline] = useState(isOnlineParam === 'true');
  const socketRef = useRef<Socket | null>(null);
  const flatListRef = useRef<FlatList>(null);
  const typingTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const insets = useSafeAreaInsets();
  const [isKeyboardVisible, setKeyboardVisible] = useState(false);
  const selectionMode = selectedMessages.length > 0;

  useEffect(() => {
    const show = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', () => setKeyboardVisible(true));
    const hide = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => setKeyboardVisible(false));
    const scroll = Keyboard.addListener('keyboardDidShow', () => setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100));
    return () => { show.remove(); hide.remove(); scroll.remove(); };
  }, []);

  const mapMsg = (m: any, myUid: string): ChatMsg => ({
    _id: String(m._id),
    sender: String(m.senderId) === myUid ? 'me' : 'other',
    text: m.text || '',
    type: m.type || 'text',
    mediaUrl: m.mediaUrl || null,
    localImageUri: m.type === 'image' && m.mediaUrl ? m.mediaUrl : undefined,
    localVoiceUri: m.type === 'audio' && m.mediaUrl ? m.mediaUrl : undefined,
    createdAt: new Date(m.createdAt).getTime(),
    pending: false,
  });

  // ── Load history & Setup Socket.IO ──────────────────────────────
  useEffect(() => {
    if (!id) return;
    let cancelled = false;

    const init = async () => {
      const token = await getAuthToken();
      const authUser = await getCurrentAuthUser();
      if (!token || !authUser || cancelled) return;

      setLoading(true);
      try {
        const history: any[] = await apiRequest(`/api/chat/history/${id}`, token);
        if (cancelled) return;
        setMessages(history.map(m => mapMsg(m, authUser.id)));
      } catch (e) {
        console.error('Failed to load history', e);
      } finally {
        if (!cancelled) setLoading(false);
      }

      // Connect Socket.IO
      const socketUrl = API_BASE.replace('/api', ''); 
      const socket = io(socketUrl, { auth: { token }, transports: ['websocket'] });
      socketRef.current = socket;

      socket.on('connect', () => {
        socket.emit('chat:join', { otherUserId: id });
        socket.emit('chat:read', { otherUserId: id });
      });

      socket.on('chat:message', (msg: any) => {
        if (cancelled) return;
        const incoming = mapMsg(msg, authUser.id);
        const clientMsgId = msg.clientMsgId;

        setMessages(prev => {
          if (prev.some(m => m._id === incoming._id)) return prev;

          if (clientMsgId) {
            const idx = prev.findIndex(m => m._id === clientMsgId);
            if (idx !== -1) {
              const newArr = [...prev];
              newArr[idx] = incoming;
              return newArr;
            }
          }

          return [...prev, incoming];
        });
        socket.emit('chat:read', { otherUserId: id });
      });

      socket.on('chat:typing', ({ senderId, isTyping: t }: any) => {
        if (String(senderId) === String(id)) {
          setIsTyping(t);
        }
      });

      // Track real-time online/offline status of the other user
      socket.on('user:online', ({ userId }: any) => {
        if (String(userId) === String(id)) setOtherUserOnline(true);
      });
      socket.on('user:offline', ({ userId }: any) => {
        if (String(userId) === String(id)) setOtherUserOnline(false);
      });
    };

    init();
    return () => {
      cancelled = true;
      socketRef.current?.disconnect();
      socketRef.current = null;
    };
  }, [id, sessionVersion]);

  useEffect(() => {
    if (messages.length > 0) setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 80);
  }, [messages.length]);

  const handleTyping = (text: string) => {
    setInputText(text);
    socketRef.current?.emit('chat:typing', { receiverId: id, isTyping: true });
    if (typingTimeout.current) clearTimeout(typingTimeout.current);
    typingTimeout.current = setTimeout(() => {
      socketRef.current?.emit('chat:typing', { receiverId: id, isTyping: false });
    }, 1500);
  };

  // Upload image to server and return a public URL
  const uploadImage = async (uri: string): Promise<string | null> => {
    try {
      const token = await getAuthToken();
      const base64 = await FileSystem.readAsStringAsync(uri, { encoding: 'base64' });
      const ext = uri.split('.').pop()?.toLowerCase() || 'jpg';
      const mimeType = ext === 'png' ? 'image/png' : ext === 'gif' ? 'image/gif' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
      const dataUri = `data:${mimeType};base64,${base64}`;

      const res = await fetch(`${API_BASE}/api/upload/image`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ base64: dataUri }),
      });
      const json = await res.json();
      return json.url || null;
    } catch (e) {
      console.error('Image upload failed', e);
      return null;
    }
  };

  const sendMessage = async () => {
    if ((!inputText.trim() && !selectedImage) || !socketRef.current) return;

    if (selectedImage) {
      const optId = `opt-img-${Date.now()}`;
      const localUri = selectedImage.uri;
      const optImg: ChatMsg = {
        _id: optId, sender: 'me', text: '', type: 'image',
        localImageUri: localUri, createdAt: Date.now(),
        replyTo: replyingTo || undefined, pending: true,
      };
      setMessages(prev => [...prev, optImg]);
      setSelectedImage(null);

      // Upload then send real URL so other user can see it
      const uploadedUrl = await uploadImage(localUri);
      if (uploadedUrl && socketRef.current) {
        socketRef.current.emit('chat:message', {
          receiverId: id,
          text: '',
          type: 'image',
          mediaUrl: uploadedUrl,
          replyTo: replyingTo ? replyingTo._id : null,
          clientMsgId: optId,
        });
      }
    }

    const text = inputText.trim();
    if (text) {
      setInputText('');
      const optId = `opt-${Date.now()}`;
      const optText: ChatMsg = {
        _id: optId, sender: 'me', text, type: 'text',
        createdAt: Date.now(), replyTo: replyingTo || undefined, pending: true,
      };
      setMessages(prev => [...prev, optText]);

      socketRef.current.emit('chat:message', {
        receiverId: id,
        text,
        type: 'text',
        replyTo: replyingTo ? replyingTo._id : null,
        clientMsgId: optId,
      });
    }

    setReplyingTo(null);
    socketRef.current.emit('chat:typing', { receiverId: id, isTyping: false });
  };

  const pickImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: 'images', allowsEditing: false, quality: 0.85 });
    if (!result.canceled) setSelectedImage({ uri: result.assets[0].uri, width: result.assets[0].width, height: result.assets[0].height });
  };

  const fmtDuration = (ms: number) => {
    const s = Math.floor(ms / 1000);
    return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;
  };

  async function startRecording() {
    const perm = await Audio.getPermissionsAsync();
    if (perm.status !== 'granted') {
      const np = await Audio.requestPermissionsAsync();
      if (np.status !== 'granted') return;
    }
    await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true, shouldDuckAndroid: true });
    const { recording } = await Audio.Recording.createAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
    setRecording(recording);
    setIsRecording(true);
    setRecordingDuration(0);
    recording.setOnRecordingStatusUpdate(s => { if (s.isRecording) setRecordingDuration(s.durationMillis); });
  }

  async function stopRecording() {
    if (!recording) return;
    setIsRecording(false);
    await recording.stopAndUnloadAsync();
    await Audio.setAudioModeAsync({ allowsRecordingIOS: false, playsInSilentModeIOS: true, shouldDuckAndroid: true, playThroughEarpieceAndroid: false });
    const uri = recording.getURI();
    setRecording(null);
    setRecordingDuration(0);
    if (uri) {
      const optId = `voice-${Date.now()}`;
      setMessages(prev => [...prev, { _id: optId, sender: 'me', text: '', type: 'audio', localVoiceUri: uri, createdAt: Date.now(), pending: true }]);
      socketRef.current?.emit('chat:message', { receiverId: id, text: '', type: 'audio', mediaUrl: uri, clientMsgId: optId });
    }
  }

  async function cancelRecording() {
    if (!recording) return;
    setIsRecording(false);
    await recording.stopAndUnloadAsync();
    await Audio.setAudioModeAsync({ allowsRecordingIOS: false, playsInSilentModeIOS: true, shouldDuckAndroid: true, playThroughEarpieceAndroid: false });
    setRecording(null);
    setRecordingDuration(0);
  }

  const deleteSelected = () => {
    setMessages(prev => prev.map(m => selectedMessages.includes(m._id) ? { ...m, isDeleted: true } : m));
    setSelectedMessages([]);
  };

  const avatarSource = photo ? { uri: photo } : (gender === 'Female' ? FALLBACK_GIRL : FALLBACK_BOY);

  return (
    <GestureHandlerRootView style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />
      <SafeAreaView edges={['top']} style={{ backgroundColor: '#fff' }}>
        {selectionMode ? (
          <View style={styles.selectionHeader}>
            <View style={styles.selectionHeaderLeft}>
              <TouchableOpacity onPress={() => setSelectedMessages([])} style={styles.backButton}>
                <Ionicons name="close" size={28} color="#333" />
              </TouchableOpacity>
              <Text style={styles.selectionCountText}>{selectedMessages.length} selected</Text>
            </View>
            <TouchableOpacity onPress={deleteSelected} style={styles.actionButton}>
              <Ionicons name="trash-outline" size={24} color="#ff4444" />
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.header}>
            <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
              <Ionicons name="chevron-back" size={28} color="#333" />
            </TouchableOpacity>
            <View style={styles.userInfo}>
              <View style={styles.avatarContainer}>
                <Image source={avatarSource} style={styles.avatar} contentFit="cover" />
                {otherUserOnline && <View style={styles.onlineIndicator} />}
              </View>
              <View>
                <Text style={styles.userName}>{name || 'User'}</Text>
                <Text style={[styles.userStatus, !isTyping && !otherUserOnline && { color: '#999' }]}>
                  {isTyping ? 'Typing...' : otherUserOnline ? 'Online' : 'Offline'}
                </Text>
              </View>
            </View>
            <View style={styles.headerActions}>
              <TouchableOpacity style={styles.actionButton}><Ionicons name="call-outline" size={22} color="#333" /></TouchableOpacity>
              <TouchableOpacity style={styles.actionButton}><Ionicons name="videocam-outline" size={22} color="#333" /></TouchableOpacity>
            </View>
          </View>
        )}
      </SafeAreaView>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.chatContainer} keyboardVerticalOffset={0}>
        {loading ? (
          <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
            <ActivityIndicator size="large" color="#8E2DE2" />
          </View>
        ) : (
          <FlatList
            style={{ flex: 1 }}
            ref={flatListRef}
            data={messages}
            renderItem={({ item }) => <MessageItem item={item} onReply={setReplyingTo} onImagePress={setFullScreenImage} onToggleSelect={msgId => setSelectedMessages(p => p.includes(msgId) ? p.filter(x => x !== msgId) : [...p, msgId])} isSelected={selectedMessages.includes(item._id)} selectionMode={selectionMode} otherName={name || 'User'} />}
            keyExtractor={item => item._id}
            contentContainerStyle={styles.messagesList}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
            ListEmptyComponent={
              <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 80 }}>
                <Ionicons name="chatbubble-outline" size={48} color="#DDD" />
                <Text style={{ color: '#CCC', marginTop: 10, fontSize: 15 }}>No messages yet. Say hi! 👋</Text>
              </View>
            }
            ListFooterComponent={isTyping ? (
              <View style={[styles.messageContainer, styles.otherMessage]}>
                <View style={[styles.bubbleWrapper, styles.otherBubbleWrapper]}>
                  <View style={[styles.messageBubble, styles.otherBubbleBorder, styles.typingBubble]}>
                    <Ionicons name="ellipsis-horizontal" size={18} color="#666" />
                  </View>
                  <View style={[styles.bubbleNotch, styles.otherNotch, { borderTopColor: '#F0F0F0' }]} />
                </View>
              </View>
            ) : null}
          />
        )}

        {replyingTo && (
          <View style={styles.replyingToContainer}>
            <View style={styles.replyingToContent}>
              <Text style={styles.replyingToName}>{replyingTo.sender === 'me' ? 'You' : (name || 'User')}</Text>
              <Text style={styles.replyingToText} numberOfLines={1}>
                {replyingTo.text || (replyingTo.localImageUri ? 'Photo' : 'Voice Message')}
              </Text>
            </View>
            <TouchableOpacity onPress={() => setReplyingTo(null)} style={styles.cancelReplyingToButton}>
              <Ionicons name="close-circle" size={24} color="#999" />
            </TouchableOpacity>
          </View>
        )}

        {selectedImage && (
          <View style={styles.imagePreviewContainer}>
            <Image source={{ uri: selectedImage.uri }} style={styles.imagePreview} contentFit="cover" />
            <TouchableOpacity onPress={() => setSelectedImage(null)} style={styles.cancelImageButton}>
              <Ionicons name="close-circle" size={24} color="#ff4444" />
            </TouchableOpacity>
          </View>
        )}

        <View style={{ backgroundColor: '#fff' }}>
          <View style={[styles.inputContainer, { paddingBottom: isKeyboardVisible ? 10 : Math.max(insets.bottom + 5, 15) }]}>
            <TouchableOpacity onPress={pickImage} style={styles.attachButton}>
              <Ionicons name="add-circle" size={30} color="#8E2DE2" />
            </TouchableOpacity>
            <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center' }}>
              <View style={[styles.inputWrapper, isRecording && { position: 'absolute', left: -9999 }]}>
                <TextInput
                  style={styles.input}
                  placeholder="Type a message..."
                  value={inputText}
                  onChangeText={handleTyping}
                  multiline
                />
              </View>
              {isRecording && (
                <View style={styles.recordingWrapper}>
                  <View style={styles.recordingIndicatorContainer}>
                    <View style={styles.recordingDot} />
                    <Text style={styles.recordingTime}>{fmtDuration(recordingDuration)}</Text>
                  </View>
                  <Text style={styles.recordingText}>Recording...</Text>
                  <TouchableOpacity onPress={cancelRecording} style={styles.deleteRecordingButton}>
                    <Ionicons name="trash-outline" size={24} color="#ff4444" />
                  </TouchableOpacity>
                </View>
              )}
            </View>
            <TouchableOpacity
              onPress={(inputText.trim() || selectedImage) ? sendMessage : (isRecording ? stopRecording : startRecording)}
              style={styles.sendButton}
            >
              <LinearGradient colors={['#8E2DE2', '#4A00E0']} style={styles.sendButtonGradient}>
                <Ionicons
                  name={(inputText.trim() || selectedImage) ? 'send' : (isRecording ? 'stop' : 'mic')}
                  size={20} color="#fff"
                />
              </LinearGradient>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>

      <Modal visible={!!fullScreenImage} transparent animationType="fade">
        <View style={styles.fullScreenContainer}>
          <TouchableOpacity style={styles.closeFullScreenButton} onPress={() => setFullScreenImage(null)}>
            <Ionicons name="close" size={32} color="#fff" />
          </TouchableOpacity>
          {fullScreenImage && <Image source={{ uri: fullScreenImage }} style={styles.fullScreenImage} contentFit="contain" />}
        </View>
      </Modal>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 15, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#F0F0F0' },
  backButton: { padding: 5 },
  userInfo: { flex: 1, flexDirection: 'row', alignItems: 'center', marginLeft: 10 },
  avatarContainer: { position: 'relative' },
  avatar: { width: 45, height: 45, borderRadius: 22.5, backgroundColor: '#F5F5F5' },
  onlineIndicator: { position: 'absolute', bottom: 2, right: 2, width: 12, height: 12, borderRadius: 6, backgroundColor: '#4CAF50', borderWidth: 2, borderColor: '#fff' },
  userName: { fontSize: 16, fontWeight: '700', color: '#333', marginLeft: 12 },
  userStatus: { fontSize: 12, color: '#4CAF50', marginLeft: 12, fontWeight: '500' },
  selectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 15, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#F0F0F0', backgroundColor: '#fff' },
  selectionHeaderLeft: { flexDirection: 'row', alignItems: 'center' },
  selectionCountText: { fontSize: 18, fontWeight: 'bold', color: '#333', marginLeft: 15 },
  headerActions: { flexDirection: 'row' },
  actionButton: { padding: 8, marginLeft: 5 },
  chatContainer: { flex: 1 },
  messagesList: { paddingVertical: 20, flexGrow: 1 },
  messageRow: { width: '100%', paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center' },
  selectedMessageRow: {},
  checkboxContainer: { marginRight: 12 },
  checkbox: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: '#ccc', justifyContent: 'center', alignItems: 'center', backgroundColor: 'transparent' },
  checkboxSelected: { backgroundColor: '#8E2DE2', borderColor: '#8E2DE2' },
  messageContainer: { marginBottom: 8, maxWidth: '85%' },
  myMessage: { alignSelf: 'flex-end' },
  otherMessage: { alignSelf: 'flex-start' },
  bubbleWrapper: { flexDirection: 'row', alignItems: 'flex-start' },
  myBubbleWrapper: { flexDirection: 'row' },
  otherBubbleWrapper: { flexDirection: 'row-reverse' },
  messageBubble: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 12, minWidth: 40 },
  myBubbleBorder: { borderTopRightRadius: 2, borderWidth: 1, borderColor: '#E5E7EB' },
  otherBubbleBorder: { borderTopLeftRadius: 2 },
  bubbleNotch: { width: 0, height: 0, backgroundColor: 'transparent', borderStyle: 'solid', borderRightWidth: 8, borderTopWidth: 8, borderRightColor: 'transparent', marginTop: 0 },
  myNotch: { transform: [{ rotate: '0deg' }], marginLeft: -1 },
  otherNotch: { transform: [{ rotate: '90deg' }], marginRight: -1 },
  messageContent: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between' },
  messageText: { fontSize: 15, lineHeight: 20, marginRight: 10, flexShrink: 1 },
  myMessageText: { color: '#fff' },
  otherMessageText: { color: '#333' },
  deletedBubbleBorder: { borderRadius: 16 },
  myDeletedBubble: { backgroundColor: 'rgba(142,45,226,0.4)', borderBottomRightRadius: 4 },
  otherDeletedBubble: { backgroundColor: '#F5F5F5', borderBottomLeftRadius: 4 },
  deletedMessageContent: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4 },
  deletedMessageText: { fontSize: 15, fontStyle: 'italic' },
  myDeletedMessageText: { color: 'rgba(255,255,255,0.7)' },
  otherDeletedMessageText: { color: '#999' },
  typingBubble: { backgroundColor: '#F0F0F0', width: 40, height: 30, alignItems: 'center', justifyContent: 'center' },
  timeWrapper: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-end', marginTop: -2 },
  messageTime: { fontSize: 10, fontWeight: '400' },
  myMessageTime: { color: 'rgba(255,255,255,0.7)' },
  otherMessageTime: { color: '#999' },
  imageBubble: { borderRadius: 16, overflow: 'hidden', borderWidth: 1, borderColor: '#E0E0E0' },
  myImageBubble: { borderTopRightRadius: 2 },
  otherImageBubble: { borderTopLeftRadius: 2 },
  voiceNoteContent: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
  playButton: { width: 35, height: 35, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  waveformContainer: { flexDirection: 'row', alignItems: 'center', flex: 1, height: 30, justifyContent: 'space-between', paddingHorizontal: 5 },
  waveformBar: { width: 3, borderRadius: 2 },
  imageTimeOverlay: { position: 'absolute', bottom: 5, right: 5, backgroundColor: 'rgba(0,0,0,0.4)', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 10, flexDirection: 'row', alignItems: 'center' },
  inputContainer: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 15, paddingTop: 10, borderTopWidth: 1, borderTopColor: '#F0F0F0', backgroundColor: '#fff' },
  attachButton: { padding: 5 },
  inputWrapper: { flex: 1, flexDirection: 'row', alignItems: 'center', backgroundColor: '#F3F4F6', borderRadius: 25, marginHorizontal: 10, paddingHorizontal: 15 },
  input: { flex: 1, paddingVertical: 10, maxHeight: 100, fontSize: 15, color: '#333' },
  sendButton: { width: 45, height: 45, borderRadius: 22.5, overflow: 'hidden' },
  sendButtonGradient: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  recordingWrapper: { flex: 1, flexDirection: 'row', alignItems: 'center', backgroundColor: '#F3F4F6', borderRadius: 25, marginHorizontal: 10, paddingHorizontal: 15, paddingVertical: 10, justifyContent: 'space-between' },
  recordingIndicatorContainer: { flexDirection: 'row', alignItems: 'center' },
  recordingDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#ff4444', marginRight: 8 },
  recordingTime: { fontSize: 15, color: '#333', fontWeight: '600' },
  recordingText: { fontSize: 14, color: '#666', flex: 1, marginLeft: 10 },
  deleteRecordingButton: { padding: 5 },
  imagePreviewContainer: { marginHorizontal: 15, marginBottom: 10, borderRadius: 12, overflow: 'hidden', position: 'relative', height: 150, width: 120, borderWidth: 0.5, borderColor: '#8E2DE2' },
  imagePreview: { width: '100%', height: '100%', borderRadius: 12 },
  cancelImageButton: { position: 'absolute', top: 5, right: 5, backgroundColor: '#fff', borderRadius: 15 },
  fullScreenContainer: { flex: 1, backgroundColor: 'rgba(0,0,0,0.9)', justifyContent: 'center', alignItems: 'center' },
  closeFullScreenButton: { position: 'absolute', top: 50, right: 20, zIndex: 10, padding: 10 },
  fullScreenImage: { width: '100%', height: '100%' },
  replyActionContainer: { justifyContent: 'center', alignItems: 'center', width: 60 },
  replyActionIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(142,45,226,0.8)', justifyContent: 'center', alignItems: 'center' },
  replyBubble: { backgroundColor: 'rgba(255,255,255,0.2)', padding: 8, borderRadius: 8, marginBottom: 5, borderLeftWidth: 4 },
  myReplyBubble: { borderLeftColor: '#fff', backgroundColor: 'rgba(255,255,255,0.15)' },
  otherReplyBubble: { borderLeftColor: '#8E2DE2', backgroundColor: 'rgba(0,0,0,0.05)' },
  replyBubbleName: { fontSize: 12, fontWeight: 'bold', marginBottom: 2 },
  myReplyBubbleName: { color: '#fff' },
  otherReplyBubbleName: { color: '#8E2DE2' },
  replyBubbleText: { fontSize: 13 },
  myReplyBubbleText: { color: 'rgba(255,255,255,0.8)' },
  otherReplyBubbleText: { color: '#666' },
  replyingToContainer: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#F3F4F6', marginHorizontal: 15, marginBottom: 10, borderRadius: 12, padding: 10, borderLeftWidth: 4, borderLeftColor: '#8E2DE2' },
  replyingToContent: { flex: 1 },
  replyingToName: { fontSize: 13, fontWeight: 'bold', color: '#8E2DE2', marginBottom: 2 },
  replyingToText: { fontSize: 13, color: '#666' },
  cancelReplyingToButton: { padding: 5 },
});
