import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  ScrollView,
  ActivityIndicator,
} from 'react';
import { Ionicons } from '@expo/vector-icons';
import { apiRequest } from '../utils/api';

const PURPLE = '#370372';

interface ChatStarter {
  id: string;
  type: 'location' | 'interest' | 'goal' | 'general';
  text: string;
  context: string;
}

interface Props {
  visible: boolean;
  onClose: () => void;
  matchedUserId: string;
  matchedUserName: string;
  token: string | null;
  onSelectStarter: (text: string) => void;
}

export function ChatStarterSheet({
  visible,
  onClose,
  matchedUserId,
  matchedUserName,
  token,
  onSelectStarter,
}: Props) {
  const [starters, setStarters] = useState<ChatStarter[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (visible && token && matchedUserId) {
      loadStarters();
    }
  }, [visible, token, matchedUserId]);

  const loadStarters = async () => {
    setLoading(true);
    try {
      const result = await apiRequest(
        `/api/engagement/chat-starters/${matchedUserId}`,
        token
      );
      setStarters(result.starters || []);
    } catch (err) {
      console.error('Failed to load chat starters:', err);
      setStarters([]);
    } finally {
      setLoading(false);
    }
  };

  const handleSelectStarter = (starter: ChatStarter) => {
    onSelectStarter(starter.text);
    onClose();
  };

  const getIconForType = (type: string) => {
    switch (type) {
      case 'location':
        return 'location';
      case 'interest':
        return 'heart';
      case 'goal':
        return 'flag';
      default:
        return 'chatbubble';
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <TouchableOpacity
        style={styles.overlay}
        activeOpacity={1}
        onPress={onClose}
      >
        <View style={styles.sheet} onStartShouldSetResponder={() => true}>
          <View style={styles.handle} />
          
          <View style={styles.header}>
            <Text style={styles.title}>Start the conversation</Text>
            <Text style={styles.subtitle}>
              Choose an icebreaker for {matchedUserName}
            </Text>
          </View>

          {loading ? (
            <View style={styles.loaderContainer}>
              <ActivityIndicator size="large" color={PURPLE} />
            </View>
          ) : (
            <ScrollView style={styles.scrollView}>
              {starters.map((starter) => (
                <TouchableOpacity
                  key={starter.id}
                  style={styles.starterCard}
                  onPress={() => handleSelectStarter(starter)}
                  activeOpacity={0.7}
                >
                  <View style={styles.starterIcon}>
                    <Ionicons
                      name={getIconForType(starter.type) as any}
                      size={20}
                      color={PURPLE}
                    />
                  </View>
                  <View style={styles.starterContent}>
                    <Text style={styles.starterText}>{starter.text}</Text>
                    <Text style={styles.starterContext}>{starter.context}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={20} color="#ccc" />
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}

          <TouchableOpacity
            style={styles.closeButton}
            onPress={onClose}
            activeOpacity={0.7}
          >
            <Text style={styles.closeButtonText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingBottom: 34,
    maxHeight: '80%',
  },
  handle: {
    width: 36,
    height: 4,
    backgroundColor: '#e0e0e0',
    borderRadius: 2,
    alignSelf: 'center',
    marginTop: 12,
    marginBottom: 20,
  },
  header: {
    paddingHorizontal: 20,
    marginBottom: 16,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#1a1a1a',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
    color: '#666',
  },
  loaderContainer: {
    paddingVertical: 40,
    alignItems: 'center',
  },
  scrollView: {
    maxHeight: 400,
  },
  starterCard: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  starterIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#F3E5F5',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  starterContent: {
    flex: 1,
    marginRight: 8,
  },
  starterText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#1a1a1a',
    marginBottom: 4,
  },
  starterContext: {
    fontSize: 12,
    color: '#666',
  },
  closeButton: {
    marginHorizontal: 20,
    marginTop: 16,
    paddingVertical: 14,
    backgroundColor: '#f5f5f5',
    borderRadius: 12,
    alignItems: 'center',
  },
  closeButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#666',
  },
});
