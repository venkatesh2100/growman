import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Modal,
  ScrollView,
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialIcons';
import { apiFetch } from '../lib/api';
import { toast } from './Toast';
import Animated, { FadeInDown, FadeInUp } from 'react-native-reanimated';

interface Message {
  id: string;
  role: 'user' | 'dootha';
  content: string;
  products?: Array<{
    id: number;
    name: string;
    price: number;
    imageUrl?: string;
  }>;
}

const DEFAULT_MESSAGE: Message = {
  id: '1',
  role: 'dootha',
  content:
    "Hi! I'm Dootha, your plant care assistant. I can help you find the perfect plants, answer care questions, and provide expert advice. How can I help you today?",
};

export default function Chatbot() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([DEFAULT_MESSAGE]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const scrollViewRef = useRef<ScrollView>(null);

  useEffect(() => {
    if (isOpen && scrollViewRef.current) {
      setTimeout(() => {
        scrollViewRef.current?.scrollToEnd({ animated: true });
      }, 100);
    }
  }, [messages, isOpen]);

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: input.trim(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    try {
      const response = await apiFetch('/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: userMessage.content,
          conversationHistory: messages.map((m) => ({
            role: m.role,
            content: m.content,
          })),
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to get response');
      }

      const data = await response.json();

      if (!data || !data.response) {
        throw new Error('Invalid response from server');
      }

      const doothaMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'dootha',
        content: data.response,
        products: data.products || [],
      };

      setMessages((prev) => [...prev, doothaMessage]);
    } catch (error) {
      console.error('Chat error:', error);
      toast('Failed to get response. Please try again.', 'error');
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'dootha',
        content: "I'm sorry, I'm having trouble connecting right now. Please try again in a moment.",
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  const renderMessage = (message: Message, index: number) => {
    const isUser = message.role === 'user';

    return (
      <Animated.View
        key={message.id}
        entering={FadeInDown.delay(index * 50).duration(300)}
        style={[styles.messageContainer, isUser ? styles.userMessage : styles.botMessage]}>
        <View style={[styles.messageBubble, isUser ? styles.userBubble : styles.botBubble]}>
          <Text style={[styles.messageText, isUser ? styles.userText : styles.botText]}>
            {message.content}
          </Text>
          {message.products && message.products.length > 0 && (
            <View style={styles.productsContainer}>
              {message.products.map((product) => (
                <TouchableOpacity key={product.id} style={styles.productCard}>
                  {product.imageUrl && (
                    <Image
                      source={{ uri: product.imageUrl }}
                      style={styles.productImage}
                      resizeMode="cover"
                    />
                  )}
                  <View style={styles.productInfo}>
                    <Text style={styles.productName} numberOfLines={2}>
                      {product.name}
                    </Text>
                    <Text style={styles.productPrice}>₹{product.price}</Text>
                  </View>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>
      </Animated.View>
    );
  };

  return (
    <>
      {/* Chat Button */}
      <TouchableOpacity
        style={styles.chatButton}
        onPress={() => setIsOpen(true)}
        activeOpacity={0.8}>
        <Icon name="chat" size={24} color="#FFFFFF" />
      </TouchableOpacity>

      {/* Chat Modal */}
      <Modal
        visible={isOpen}
        animationType="slide"
        transparent
        onRequestClose={() => setIsOpen(false)}>
        <KeyboardAvoidingView
          style={styles.modalContainer}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={styles.modalContent}>
            {/* Header */}
            <View style={styles.header}>
              <View style={styles.headerLeft}>
                <View style={styles.botAvatar}>
                  <Icon name="smart-toy" size={24} color="#059669" />
                </View>
                <View>
                  <Text style={styles.botName}>Dootha</Text>
                  <Text style={styles.botStatus}>Plant Care Assistant</Text>
                </View>
              </View>
              <TouchableOpacity onPress={() => setIsOpen(false)}>
                <Icon name="close" size={24} color="#111827" />
              </TouchableOpacity>
            </View>

            {/* Messages */}
            <ScrollView
              ref={scrollViewRef}
              style={styles.messagesContainer}
              contentContainerStyle={styles.messagesContent}>
              {messages.map((message, index) => renderMessage(message, index))}
              {isLoading && (
                <View style={[styles.messageContainer, styles.botMessage]}>
                  <View style={[styles.messageBubble, styles.botBubble]}>
                    <ActivityIndicator size="small" color="#059669" />
                  </View>
                </View>
              )}
            </ScrollView>

            {/* Input */}
            <View style={styles.inputContainer}>
              <TextInput
                style={styles.input}
                placeholder="Type your message..."
                value={input}
                onChangeText={setInput}
                placeholderTextColor="#9CA3AF"
                multiline
                maxLength={500}
                onSubmitEditing={handleSend}
                returnKeyType="send"
              />
              <TouchableOpacity
                style={[styles.sendButton, (!input.trim() || isLoading) && styles.sendButtonDisabled]}
                onPress={handleSend}
                disabled={!input.trim() || isLoading}>
                <Icon name="send" size={20} color="#FFFFFF" />
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  chatButton: {
    position: 'absolute',
    bottom: 80,
    right: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#059669',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
    zIndex: 1000,
  },
  modalContainer: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  modalContent: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    marginTop: 100,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
    backgroundColor: '#F9FAFB',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  botAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#D1FAE5',
    justifyContent: 'center',
    alignItems: 'center',
  },
  botName: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#111827',
  },
  botStatus: {
    fontSize: 12,
    color: '#6B7280',
  },
  messagesContainer: {
    flex: 1,
  },
  messagesContent: {
    padding: 16,
    gap: 12,
  },
  messageContainer: {
    marginBottom: 8,
  },
  userMessage: {
    alignItems: 'flex-end',
  },
  botMessage: {
    alignItems: 'flex-start',
  },
  messageBubble: {
    maxWidth: '80%',
    padding: 12,
    borderRadius: 16,
  },
  userBubble: {
    backgroundColor: '#059669',
    borderBottomRightRadius: 4,
  },
  botBubble: {
    backgroundColor: '#F3F4F6',
    borderBottomLeftRadius: 4,
  },
  messageText: {
    fontSize: 15,
    lineHeight: 20,
  },
  userText: {
    color: '#FFFFFF',
  },
  botText: {
    color: '#111827',
  },
  productsContainer: {
    marginTop: 12,
    gap: 8,
  },
  productCard: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 8,
    gap: 8,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  productImage: {
    width: 60,
    height: 60,
    borderRadius: 8,
    backgroundColor: '#F3F4F6',
  },
  productInfo: {
    flex: 1,
    justifyContent: 'center',
  },
  productName: {
    fontSize: 13,
    fontWeight: '600',
    color: '#111827',
    marginBottom: 4,
  },
  productPrice: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#059669',
  },
  inputContainer: {
    flexDirection: 'row',
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
    backgroundColor: '#FFFFFF',
    gap: 12,
    alignItems: 'flex-end',
  },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 100,
    backgroundColor: '#F3F4F6',
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 15,
    color: '#111827',
  },
  sendButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#059669',
    justifyContent: 'center',
    alignItems: 'center',
  },
  sendButtonDisabled: {
    backgroundColor: '#D1D5DB',
  },
});

