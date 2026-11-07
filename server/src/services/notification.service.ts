import { Expo, ExpoPushMessage } from 'expo-server-sdk';

const expo = new Expo({ accessToken: process.env.EXPO_ACCESS_TOKEN });

type PushNotificationData = Record<string, string | number | boolean | undefined> | undefined;

export const sendPushNotification = async (
  expoPushToken: string,
  title: string,
  body: string,
  data?: PushNotificationData,
  badge?: number
) => {
  if (!Expo.isExpoPushToken(expoPushToken)) {
    console.error(`Token Expo invalide: ${expoPushToken}`);
    return;
  }

  const messages: ExpoPushMessage[] = [{
    to: expoPushToken,
    sound: 'default',
    title,
    body,
    data,
    priority: 'high',
    channelId: 'default',
    ...(badge === undefined ? {} : { badge }),
  }];

  try {
    const chunks = expo.chunkPushNotifications(messages);
    for (const chunk of chunks) {
      const tickets = await expo.sendPushNotificationsAsync(chunk);
      const failures = tickets.filter((ticket) => ticket.status === 'error');
      if (failures.length > 0) {
        throw new Error(failures.map((ticket) => ticket.message).join('; '));
      }
    }
  } catch (error) {
    console.error('Erreur lors de l\'envoi de la notification push:', error);
    throw error;
  }
};
