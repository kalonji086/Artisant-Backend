import { Expo, ExpoPushMessage } from 'expo-server-sdk';

const expo = new Expo({ accessToken: process.env.EXPO_ACCESS_TOKEN });

type PushNotificationData = Record<string, string | number | boolean | undefined> | undefined;

export const sendPushNotification = async (
  expoPushToken: string,
  title: string,
  body: string,
  data?: PushNotificationData
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
  }];

  try {
    const chunks = expo.chunkPushNotifications(messages);
    for (const chunk of chunks) {
      await expo.sendPushNotificationsAsync(chunk);
    }
  } catch (error) {
    console.error('Erreur lors de l\'envoi de la notification push:', error);
  }
};
