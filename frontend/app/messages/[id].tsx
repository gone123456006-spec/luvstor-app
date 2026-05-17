import { Ionicons } from '@expo/vector-icons';
import { Audio } from 'expo-av';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { LinearGradient } from 'expo-linear-gradient';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import {
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
  View
} from 'react-native';
import { GestureHandlerRootView, Swipeable } from 'react-native-gesture-handler';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

const { width: screenWidth } = Dimensions.get('window');
const IMG_BUBBLE_WIDTH = Math.min(screenWidth * 0.70, 280);

interface Message {
  id: string;
  text?: string;
  image?: string;
  voice?: string;
  imageWidth?: number;
  imageHeight?: number;
  sender: 'me' | 'other';
  time: string;
  replyTo?: Message;
  isDeleted?: boolean;
}

const INITIAL_MESSAGES: Message[] = [
  {
    id: '1',
    text: 'Hey! How are you doing today?',
    sender: 'other',
    time: '10:00 AM',
  },
];

const VoiceMessage = ({ uri, isMe, time, replyTo }: { uri: string; isMe: boolean; time: string; replyTo?: Message }) => {
  const [sound, setSound] = useState<Audio.Sound | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);

  async function playSound() {
    if (sound) {
      if (isPlaying) {
        await sound.pauseAsync();
        setIsPlaying(false);
      } else {
        await sound.playAsync();
        setIsPlaying(true);
      }
    } else {
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
        shouldDuckAndroid: true,
        playThroughEarpieceAndroid: false,
      });
      const { sound: newSound } = await Audio.Sound.createAsync(
        { uri },
        { shouldPlay: true }
      );
      setSound(newSound);
      setIsPlaying(true);
      newSound.setOnPlaybackStatusUpdate((status) => {
        if (status.isLoaded && status.didJustFinish) {
          setIsPlaying(false);
          newSound.setPositionAsync(0);
        }
      });
    }
  }

  useEffect(() => {
    return sound
      ? () => {
        sound.unloadAsync();
      }
      : undefined;
  }, [sound]);

  return (
    <View style={[styles.bubbleWrapper, isMe ? styles.myBubbleWrapper : styles.otherBubbleWrapper]}>
      <LinearGradient
        colors={isMe ? ['#8E2DE2', '#8E2DE2'] : ['#F0F0F0', '#F0F0F0']}
        style={[styles.messageBubble, isMe ? styles.myBubbleBorder : styles.otherBubbleBorder, { width: 220 }]}
      >
        {replyTo && (
          <View style={[styles.replyBubble, isMe ? styles.myReplyBubble : styles.otherReplyBubble]}>
            <Text style={[styles.replyBubbleName, isMe ? styles.myReplyBubbleName : styles.otherReplyBubbleName]}>
              {replyTo.sender === 'me' ? 'You' : 'Sarah'}
            </Text>
            <Text style={[styles.replyBubbleText, isMe ? styles.myReplyBubbleText : styles.otherReplyBubbleText]} numberOfLines={1}>
              {replyTo.text || (replyTo.image ? 'Photo' : 'Voice Message')}
            </Text>
          </View>
        )}
        <View style={styles.voiceNoteContent}>
          <TouchableOpacity onPress={playSound} style={styles.playButton}>
            <Ionicons name={isPlaying ? "pause" : "play"} size={24} color={isMe ? '#fff' : '#8E2DE2'} />
          </TouchableOpacity>
          <View style={styles.waveformContainer}>
            <View style={[styles.waveformBar, { height: 15, backgroundColor: isMe ? 'rgba(255,255,255,0.4)' : '#ccc' }]} />
            <View style={[styles.waveformBar, { height: 25, backgroundColor: isMe ? 'rgba(255,255,255,0.4)' : '#ccc' }]} />
            <View style={[styles.waveformBar, { height: 20, backgroundColor: isMe ? 'rgba(255,255,255,0.4)' : '#ccc' }]} />
            <View style={[styles.waveformBar, { height: 30, backgroundColor: isMe ? '#fff' : '#8E2DE2' }]} />
            <View style={[styles.waveformBar, { height: 20, backgroundColor: isMe ? 'rgba(255,255,255,0.4)' : '#ccc' }]} />
            <View style={[styles.waveformBar, { height: 25, backgroundColor: isMe ? 'rgba(255,255,255,0.4)' : '#ccc' }]} />
            <View style={[styles.waveformBar, { height: 15, backgroundColor: isMe ? 'rgba(255,255,255,0.4)' : '#ccc' }]} />
          </View>
          <Text style={[styles.voiceDuration, { color: isMe ? 'rgba(255,255,255,0.8)' : '#666' }]}>0:12</Text>
        </View>
        <View style={styles.timeWrapper}>
          <Text style={[styles.messageTime, isMe ? styles.myMessageTime : styles.otherMessageTime]}>
            {time}
          </Text>
          {isMe && <Ionicons name="checkmark-done" size={15} color="#4FC3F7" style={{ marginLeft: 4 }} />}
        </View>
      </LinearGradient>
      <View style={[styles.bubbleNotch, isMe ? styles.myNotch : styles.otherNotch, { borderTopColor: isMe ? '#8E2DE2' : '#F0F0F0' }]} />
    </View>
  );
};

const MessageItem = ({
  item,
  onReply,
  onImagePress,
  onToggleSelect,
  isSelected,
  selectionMode,
  otherUserName,
}: {
  item: Message;
  onReply: (msg: Message) => void;
  onImagePress: (uri: string) => void;
  onToggleSelect: (id: string) => void;
  isSelected: boolean;
  selectionMode: boolean;
  otherUserName: string;
}) => {
  const isMe = item.sender === 'me';
  const swipeableRef = useRef<Swipeable>(null);

  const handleSwipe = () => {
    if (item.isDeleted || selectionMode) return;
    onReply(item);
    swipeableRef.current?.close();
  };

  const handleLongPress = () => {
    if (item.isDeleted) return;
    if (!selectionMode) {
      onToggleSelect(item.id);
    }
  };

  const renderLeftActions = () => {
    if (isMe) return null;
    return (
      <View style={styles.replyActionContainer}>
        <View style={styles.replyActionIcon}>
          <Ionicons name="arrow-undo" size={20} color="#fff" />
        </View>
      </View>
    );
  };

  const renderRightActions = () => {
    if (!isMe) return null;
    return (
      <View style={styles.replyActionContainer}>
        <View style={styles.replyActionIcon}>
          <Ionicons name="arrow-undo" size={20} color="#fff" />
        </View>
      </View>
    );
  };

  const renderReplyPreview = () => {
    if (!item.replyTo) return null;
    return (
      <View style={[styles.replyBubble, isMe ? styles.myReplyBubble : styles.otherReplyBubble]}>
        <Text style={[styles.replyBubbleName, isMe ? styles.myReplyBubbleName : styles.otherReplyBubbleName]}>
          {item.replyTo.sender === 'me' ? 'You' : otherUserName}
        </Text>
        <Text style={[styles.replyBubbleText, isMe ? styles.myReplyBubbleText : styles.otherReplyBubbleText]} numberOfLines={1}>
          {item.replyTo.text || (item.replyTo.image ? 'Photo' : 'Voice Message')}
        </Text>
      </View>
    );
  };

  const renderContent = () => {
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
            <View style={[styles.bubbleNotch, isMe ? styles.myNotch : styles.otherNotch, { borderTopColor: isMe ? 'rgba(142, 45, 226, 0.4)' : '#F5F5F5' }]} />
          </View>
        </View>
      );
    }

    if (item.image) {
      const ratio = item.imageWidth && item.imageHeight ? item.imageWidth / item.imageHeight : 1;
      const imgHeight = Math.min(IMG_BUBBLE_WIDTH / ratio, 380);
      return (
        <View style={[styles.messageContainer, isMe ? styles.myMessage : styles.otherMessage]}>
          <View style={[styles.bubbleWrapper, isMe ? styles.myBubbleWrapper : styles.otherBubbleWrapper]}>
            <TouchableOpacity
              activeOpacity={0.85}
              onPress={() => onImagePress(item.image!)}
              style={[
                styles.imageBubble,
                isMe ? styles.myImageBubble : styles.otherImageBubble,
                {
                  backgroundColor: 'transparent',
                  borderWidth: 0,
                  padding: 0,
                  width: IMG_BUBBLE_WIDTH,
                }
              ]}>
              <View style={{ borderRadius: 16, overflow: 'hidden' }}>
                {renderReplyPreview()}
                <Image
                  source={{ uri: item.image }}
                  style={{ width: IMG_BUBBLE_WIDTH, height: imgHeight }}
                  contentFit="cover"
                />
                <View style={styles.imageTimeOverlay}>
                  {isMe && <Ionicons name="checkmark-done" size={15} color="#4FC3F7" style={{ marginRight: 4 }} />}
                  <Text style={[styles.messageTime, { color: '#fff' }]}>{item.time}</Text>
                </View>
              </View>
            </TouchableOpacity>
            <View style={[styles.bubbleNotch, isMe ? styles.myNotch : styles.otherNotch, { borderTopColor: isMe ? '#8E2DE2' : '#F0F0F0', opacity: 0 }]} />
          </View>
        </View>
      );
    }

    if (item.voice) {
      return (
        <View style={[styles.messageContainer, isMe ? styles.myMessage : styles.otherMessage]}>
          <VoiceMessage uri={item.voice} isMe={isMe} time={item.time} replyTo={item.replyTo} />
        </View>
      );
    }

    return (
      <View style={[styles.messageContainer, isMe ? styles.myMessage : styles.otherMessage]}>
        <View style={[styles.bubbleWrapper, isMe ? styles.myBubbleWrapper : styles.otherBubbleWrapper]}>
          <View>
            <LinearGradient
              colors={isMe ? ['#8E2DE2', '#8E2DE2'] : ['#F0F0F0', '#F0F0F0']}
              style={[styles.messageBubble, isMe ? styles.myBubbleBorder : styles.otherBubbleBorder]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
            >
              {renderReplyPreview()}
              <View style={styles.messageContent}>
                <Text style={[styles.messageText, isMe ? styles.myMessageText : styles.otherMessageText]}>
                  {item.text}
                </Text>
                <View style={styles.timeWrapper}>
                  <Text style={[styles.messageTime, isMe ? styles.myMessageTime : styles.otherMessageTime]}>
                    {item.time}
                  </Text>
                  {isMe && <Ionicons name="checkmark-done" size={15} color="#4FC3F7" style={{ marginLeft: 4 }} />}
                </View>
              </View>
            </LinearGradient>
          </View>
          <View style={[styles.bubbleNotch, isMe ? styles.myNotch : styles.otherNotch, { borderTopColor: isMe ? '#8E2DE2' : '#F0F0F0' }]} />
        </View>
      </View>
    );
  };

  return (
    <Swipeable
      ref={swipeableRef}
      renderLeftActions={!isMe && !selectionMode ? renderLeftActions : undefined}
      renderRightActions={isMe && !selectionMode ? renderRightActions : undefined}
      onSwipeableWillOpen={handleSwipe}
      overshootLeft={false}
      overshootRight={false}
      friction={2}
    >
      <Pressable
        onLongPress={handleLongPress}
        onPress={selectionMode && !item.isDeleted ? () => onToggleSelect(item.id) : undefined}
        style={[styles.messageRow, isSelected && styles.selectedMessageRow]}
      >
        {selectionMode && !item.isDeleted && (
          <View style={styles.checkboxContainer}>
            <View style={[styles.checkbox, isSelected && styles.checkboxSelected]}>
              {isSelected && <Ionicons name="checkmark" size={14} color="#fff" />}
            </View>
          </View>
        )}
        <View pointerEvents={selectionMode ? "none" : "box-none"} style={{ flex: 1 }}>
          {renderContent()}
        </View>
      </Pressable>
    </Swipeable>
  );
};

export default function MessageScreen() {
  const { id, name } = useLocalSearchParams();
  const router = useRouter();
  const [messages, setMessages] = useState<Message[]>(INITIAL_MESSAGES);
  const [inputText, setInputText] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [selectedImage, setSelectedImage] = useState<{ uri: string, width: number, height: number } | null>(null);
  const [fullScreenImage, setFullScreenImage] = useState<string | null>(null);
  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
  const [selectedMessages, setSelectedMessages] = useState<string[]>([]);
  const flatListRef = useRef<FlatList>(null);

  const selectionMode = selectedMessages.length > 0;

  const insets = useSafeAreaInsets();
  const [isKeyboardVisible, setKeyboardVisible] = useState(false);

  useEffect(() => {
    const keyboardDidShowListener = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
      () => setKeyboardVisible(true)
    );
    const keyboardDidHideListener = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
      () => setKeyboardVisible(false)
    );

    return () => {
      keyboardDidHideListener.remove();
      keyboardDidShowListener.remove();
    };
  }, []);

  const formatDuration = (millis: number) => {
    const totalSeconds = Math.floor(millis / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
  };

  useEffect(() => {
    const showSubscription = Keyboard.addListener('keyboardDidShow', () => {
      setTimeout(() => {
        flatListRef.current?.scrollToEnd({ animated: true });
      }, 100);
    });
    return () => showSubscription.remove();
  }, []);

  // Fallback images based on id or name
  const avatarImage = id === '1' ? require('../../assets/images/girls-image.png') : require('../../assets/images/boy-image.png');

  const sendImage = async () => {
    // Use the system photo picker — no broad READ_MEDIA_IMAGES permission needed
    // (expo-image-picker v17+ uses the Android Photo Picker by default)
    let result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: 'images',
      allowsEditing: false,
      quality: 0.85,
    });

    if (!result.canceled) {
      const asset = result.assets[0];
      setSelectedImage({
        uri: asset.uri,
        width: asset.width,
        height: asset.height
      });
    }
  };

  const cancelImage = () => {
    setSelectedImage(null);
  };

  async function startRecording() {
    try {
      // Request RECORD_AUDIO permission only when the user explicitly taps mic
      const permission = await Audio.getPermissionsAsync();
      if (permission.status !== 'granted') {
        const newPermission = await Audio.requestPermissionsAsync();
        // Gracefully degrade — do not alert(), per Google Play policy
        if (newPermission.status !== 'granted') return;
      }

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
        // staysActiveInBackground intentionally omitted — Luvstor is a foreground chat app.
        // Enabling it on Android 14+ would require FOREGROUND_SERVICE permission.
        shouldDuckAndroid: true,
      });

      const { recording } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY
      );
      setRecording(recording);
      setIsRecording(true);
      setRecordingDuration(0);

      recording.setOnRecordingStatusUpdate((status) => {
        if (status.isRecording) {
          setRecordingDuration(status.durationMillis);
        }
      });
    } catch (err) {
      console.error('Failed to start recording', err);
    }
  }

  async function stopRecording() {
    if (!recording) return;
    setIsRecording(false);
    try {
      await recording.stopAndUnloadAsync();

      // Reset audio mode after recording is done so playback defaults to speakers
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
        shouldDuckAndroid: true,
        playThroughEarpieceAndroid: false,
      });

      const uri = recording.getURI();
      setRecording(null);
      setRecordingDuration(0);
      if (uri) {
        const newMessage: Message = {
          id: Date.now().toString(),
          voice: uri,
          sender: 'me',
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        };
        setMessages(prev => [...prev, newMessage]);
      }
    } catch (error) {
      console.error('Failed to stop recording', error);
    }
  }

  async function cancelRecording() {
    if (!recording) return;
    setIsRecording(false);
    try {
      await recording.stopAndUnloadAsync();
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
        shouldDuckAndroid: true,
        playThroughEarpieceAndroid: false,
      });
      setRecording(null);
      setRecordingDuration(0);
    } catch (error) {
      console.error('Failed to cancel recording', error);
    }
  }

  const sendMessage = () => {
    if (inputText.trim() === '' && !selectedImage) return;

    const newMessages: Message[] = [];
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    if (selectedImage) {
      newMessages.push({
        id: Date.now().toString() + '-img',
        image: selectedImage.uri,
        imageWidth: selectedImage.width,
        imageHeight: selectedImage.height,
        sender: 'me',
        time,
        replyTo: replyingTo || undefined,
      });
      setSelectedImage(null);
    }

    if (inputText.trim() !== '') {
      newMessages.push({
        id: Date.now().toString() + '-txt',
        text: inputText,
        sender: 'me',
        time,
        replyTo: selectedImage ? undefined : (replyingTo || undefined),
      });
      setInputText('');
    }

    setMessages(prev => [...prev, ...newMessages]);
    setReplyingTo(null);

    // Simulate other person typing
    setTimeout(() => {
      setIsTyping(true);
      setTimeout(() => {
        setIsTyping(false);
        const reply: Message = {
          id: (Date.now() + 1).toString(),
          text: selectedImage ? "Wow, that looks amazing! 😍" : "That's awesome! Let's talk more about it. 😊",
          sender: 'other',
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        };
        setMessages(prev => [...prev, reply]);
      }, 2000);
    }, 1000);
  };

  const deleteSelectedMessages = () => {
    setMessages(prev => prev.map(m => selectedMessages.includes(m.id) ? { ...m, isDeleted: true } : m));
    setSelectedMessages([]);
  };

  const toggleSelect = (id: string) => {
    setSelectedMessages(prev =>
      prev.includes(id) ? prev.filter(msgId => msgId !== id) : [...prev, id]
    );
  };

  const renderMessage = ({ item }: { item: Message }) => (
    <MessageItem
      item={item}
      onReply={setReplyingTo}
      onImagePress={setFullScreenImage}
      onToggleSelect={toggleSelect}
      isSelected={selectedMessages.includes(item.id)}
      selectionMode={selectionMode}
      otherUserName={(name as string) || 'Sarah'}
    />
  );

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
            <TouchableOpacity onPress={deleteSelectedMessages} style={styles.actionButton}>
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
                <Image
                  source={avatarImage}
                  style={styles.avatar}
                />
                <View style={styles.onlineIndicator} />
              </View>
              <View>
                <Text style={styles.userName}>{name || 'Sarah'}</Text>
                <Text style={styles.userStatus}>{isTyping ? 'Typing...' : 'Online'}</Text>
              </View>
            </View>
            <View style={styles.headerActions}>
              <TouchableOpacity style={styles.actionButton}>
                <Ionicons name="call-outline" size={22} color="#333" />
              </TouchableOpacity>
              <TouchableOpacity style={styles.actionButton}>
                <Ionicons name="videocam-outline" size={22} color="#333" />
              </TouchableOpacity>
            </View>
          </View>
        )}
      </SafeAreaView>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.chatContainer}
        keyboardVerticalOffset={0}
      >
        <FlatList
          style={{ flex: 1 }}
          ref={flatListRef}
          data={messages}
          renderItem={renderMessage}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.messagesList}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
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

        {replyingTo && (
          <View style={styles.replyingToContainer}>
            <View style={styles.replyingToContent}>
              <Text style={styles.replyingToName}>{replyingTo.sender === 'me' ? 'You' : (name || 'Sarah')}</Text>
              <Text style={styles.replyingToText} numberOfLines={1}>
                {replyingTo.text || (replyingTo.image ? 'Photo' : 'Voice Message')}
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
            <TouchableOpacity onPress={cancelImage} style={styles.cancelImageButton}>
              <Ionicons name="close-circle" size={24} color="#ff4444" />
            </TouchableOpacity>
          </View>
        )}
        <View style={{ backgroundColor: '#fff' }}>
          <View style={[styles.inputContainer, { paddingBottom: isKeyboardVisible ? 10 : Math.max(insets.bottom + 5, 15) }]}>
            <TouchableOpacity onPress={sendImage} style={styles.attachButton}>
              <Ionicons name="add-circle" size={30} color="#8E2DE2" />
            </TouchableOpacity>
            <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center' }}>
              <View
                style={[styles.inputWrapper, isRecording && { position: 'absolute', left: -9999 }]}
              >
                <TextInput
                  style={styles.input}
                  placeholder="Type a message..."
                  value={inputText}
                  onChangeText={setInputText}
                  multiline
                />

              </View>

              {isRecording && (
                <View style={styles.recordingWrapper}>
                  <View style={styles.recordingIndicatorContainer}>
                    <View style={styles.recordingDot} />
                    <Text style={styles.recordingTime}>{formatDuration(recordingDuration)}</Text>
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
              <LinearGradient
                colors={['#8E2DE2', '#4A00E0']}
                style={[styles.sendButtonGradient, isRecording && { backgroundColor: '#ff4444' }]}
              >
                <Ionicons
                  name={(inputText.trim() || selectedImage) ? "send" : (isRecording ? "stop" : "mic")}
                  size={20}
                  color="#fff"
                />
              </LinearGradient>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>

      <Modal visible={!!fullScreenImage} transparent={true} animationType="fade">
        <View style={styles.fullScreenContainer}>
          <TouchableOpacity
            style={styles.closeFullScreenButton}
            onPress={() => setFullScreenImage(null)}
          >
            <Ionicons name="close" size={32} color="#fff" />
          </TouchableOpacity>
          {fullScreenImage && (
            <Image
              source={{ uri: fullScreenImage }}
              style={styles.fullScreenImage}
              contentFit="contain"
            />
          )}
        </View>
      </Modal>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 15,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0F0',
  },
  backButton: {
    padding: 5,
  },
  userInfo: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: 10,
  },
  avatarContainer: {
    position: 'relative',
  },
  avatar: {
    width: 45,
    height: 45,
    borderRadius: 22.5,
    backgroundColor: '#F5F5F5',
  },
  onlineIndicator: {
    position: 'absolute',
    bottom: 2,
    right: 2,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#4CAF50',
    borderWidth: 2,
    borderColor: '#fff',
  },
  userName: {
    fontSize: 16,
    fontWeight: '700',
    color: '#333',
    marginLeft: 12,
  },
  userStatus: {
    fontSize: 12,
    color: '#4CAF50',
    marginLeft: 12,
    fontWeight: '500',
  },
  selectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 15,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0F0',
    backgroundColor: '#fff',
  },
  selectionHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  selectionCountText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
    marginLeft: 15,
  },
  headerActions: {
    flexDirection: 'row',
  },
  actionButton: {
    padding: 8,
    marginLeft: 5,
  },
  chatContainer: {
    flex: 1,
  },
  messagesList: {
    paddingVertical: 20,
    flexGrow: 1,
  },
  messageRow: {
    width: '100%',
    paddingHorizontal: 20,
    flexDirection: 'row',
    alignItems: 'center',
  },
  selectedMessageRow: {
    // Background color removed based on user request; only using the tick circle now.
  },
  checkboxContainer: {
    marginRight: 12,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: '#ccc',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'transparent',
  },
  checkboxSelected: {
    backgroundColor: '#8E2DE2',
    borderColor: '#8E2DE2',
  },
  messageContainer: {
    marginBottom: 8,
    maxWidth: '85%',
  },
  myMessage: {
    alignSelf: 'flex-end',
  },
  otherMessage: {
    alignSelf: 'flex-start',
  },
  bubbleWrapper: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  myBubbleWrapper: {
    flexDirection: 'row',
  },
  otherBubbleWrapper: {
    flexDirection: 'row-reverse',
  },
  messageBubble: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
    minWidth: 40,
  },
  myBubbleBorder: {
    borderTopRightRadius: 2,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  otherBubbleBorder: {
    borderTopLeftRadius: 2,
  },
  bubbleNotch: {
    width: 0,
    height: 0,
    backgroundColor: 'transparent',
    borderStyle: 'solid',
    borderRightWidth: 8,
    borderTopWidth: 8,
    borderRightColor: 'transparent',
    marginTop: 0,
  },
  myNotch: {
    transform: [{ rotate: '0deg' }],
    marginLeft: -1,
  },
  otherNotch: {
    transform: [{ rotate: '90deg' }],
    marginRight: -1,
  },
  messageContent: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
  },
  messageText: {
    fontSize: 15,
    lineHeight: 20,
    marginRight: 10,
    flexShrink: 1,
  },
  myMessageText: {
    color: '#fff',
  },
  otherMessageText: {
    color: '#333',
  },
  deletedBubbleBorder: {
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderBottomLeftRadius: 16,
    borderBottomRightRadius: 16,
  },
  myDeletedBubble: {
    backgroundColor: 'rgba(142, 45, 226, 0.4)',
    borderBottomRightRadius: 4,
  },
  otherDeletedBubble: {
    backgroundColor: '#F5F5F5',
    borderBottomLeftRadius: 4,
  },
  deletedMessageContent: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
  },
  deletedMessageText: {
    fontSize: 15,
    fontStyle: 'italic',
  },
  myDeletedMessageText: {
    color: 'rgba(255, 255, 255, 0.7)',
  },
  otherDeletedMessageText: {
    color: '#999',
  },
  typingBubble: {
    backgroundColor: '#F0F0F0',
    width: 40,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  timeWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-end',
    marginTop: -2,
  },
  messageTime: {
    fontSize: 10,
    fontWeight: '400',
  },
  myMessageTime: {
    color: 'rgba(255,255,255,0.7)',
  },
  otherMessageTime: {
    color: '#999',
  },
  imageBubble: {
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#E0E0E0',
  },
  myImageBubble: {
    borderTopRightRadius: 2,
  },
  otherImageBubble: {
    borderTopLeftRadius: 2,
  },
  voiceNoteContent: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  playButton: {
    width: 35,
    height: 35,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  waveformContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    height: 30,
    justifyContent: 'space-between',
    paddingHorizontal: 5,
  },
  waveformBar: {
    width: 3,
    borderRadius: 2,
  },
  voiceDuration: {
    fontSize: 12,
    marginLeft: 10,
    minWidth: 30,
  },
  imageTimeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingTop: 4,
    paddingHorizontal: 2,
  },
  sentImage: {
    width: 260,
    minHeight: 180,
    maxHeight: 380,
  },
  imageTimeOverlay: {
    position: 'absolute',
    bottom: 5,
    right: 5,
    backgroundColor: 'rgba(0,0,0,0.4)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 10,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 15,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#F0F0F0',
    backgroundColor: '#fff',
  },
  attachButton: {
    padding: 5,
  },
  inputWrapper: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F3F4F6',
    borderRadius: 25,
    marginHorizontal: 10,
    paddingHorizontal: 15,
  },
  input: {
    flex: 1,
    paddingVertical: 10,
    maxHeight: 100,
    fontSize: 15,
    color: '#333',
  },
  emojiButton: {
    padding: 5,
  },
  sendButton: {
    width: 45,
    height: 45,
    borderRadius: 22.5,
    overflow: 'hidden',
  },
  sendButtonGradient: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  recordingWrapper: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F3F4F6',
    borderRadius: 25,
    marginHorizontal: 10,
    paddingHorizontal: 15,
    paddingVertical: 10,
    justifyContent: 'space-between',
  },
  recordingIndicatorContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  recordingDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#ff4444',
    marginRight: 8,
  },
  recordingTime: {
    fontSize: 15,
    color: '#333',
    fontWeight: '600',
  },
  recordingText: {
    fontSize: 14,
    color: '#666',
    flex: 1,
    marginLeft: 10,
  },
  deleteRecordingButton: {
    padding: 5,
  },
  imagePreviewContainer: {
    marginHorizontal: 15,
    marginBottom: 10,
    borderRadius: 12,
    overflow: 'hidden',
    position: 'relative',
    height: 150,
    width: 120,
    borderWidth: 0.5,
    borderColor: '#8E2DE2',
  },
  imagePreview: {
    width: '100%',
    height: '100%',
    borderRadius: 12,
  },
  cancelImageButton: {
    position: 'absolute',
    top: 5,
    right: 5,
    backgroundColor: '#fff',
    borderRadius: 15,
  },
  fullScreenContainer: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.9)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  closeFullScreenButton: {
    position: 'absolute',
    top: 50,
    right: 20,
    zIndex: 10,
    padding: 10,
  },
  fullScreenImage: {
    width: '100%',
    height: '100%',
  },
  replyActionContainer: {
    justifyContent: 'center',
    alignItems: 'center',
    width: 60,
  },
  replyActionIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(142, 45, 226, 0.8)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  replyBubble: {
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    padding: 8,
    borderRadius: 8,
    marginBottom: 5,
    borderLeftWidth: 4,
  },
  myReplyBubble: {
    borderLeftColor: '#fff',
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
  },
  otherReplyBubble: {
    borderLeftColor: '#8E2DE2',
    backgroundColor: 'rgba(0, 0, 0, 0.05)',
  },
  replyBubbleName: {
    fontSize: 12,
    fontWeight: 'bold',
    marginBottom: 2,
  },
  myReplyBubbleName: {
    color: '#fff',
  },
  otherReplyBubbleName: {
    color: '#8E2DE2',
  },
  replyBubbleText: {
    fontSize: 13,
  },
  myReplyBubbleText: {
    color: 'rgba(255, 255, 255, 0.8)',
  },
  otherReplyBubbleText: {
    color: '#666',
  },
  replyingToContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F3F4F6',
    marginHorizontal: 15,
    marginBottom: 10,
    borderRadius: 12,
    padding: 10,
    borderLeftWidth: 4,
    borderLeftColor: '#8E2DE2',
  },
  replyingToContent: {
    flex: 1,
  },
  replyingToName: {
    fontSize: 13,
    fontWeight: 'bold',
    color: '#8E2DE2',
    marginBottom: 2,
  },
  replyingToText: {
    fontSize: 13,
    color: '#666',
  },
  cancelReplyingToButton: {
    padding: 5,
  },
});
