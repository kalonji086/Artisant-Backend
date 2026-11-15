import { Expo, type ExpoPushMessage, type ExpoPushTicket } from 'expo-server-sdk';

const expo = new Expo({ accessToken: process.env.EXPO_ACCESS_TOKEN });

type PushNotificationData = Record<string, unknown> | undefined;

export const sendPushNotification = async (
  expoPushToken: string,
  title: string,
  body: string,
  data?: PushNotificationData
): Promise<ExpoPushTicket[]> => {
  if (!Expo.isExpoPushToken(expoPushToken)) {
    throw new Error('Jeton Expo Push invalide.');
  }

  const messages: ExpoPushMessage[] = [{
    to: expoPushToken,
    sound: 'default',
    title,
    body,
    data,
  }];

  const tickets: ExpoPushTicket[] = [];
  const chunks = expo.chunkPushNotifications(messages);
  for (const chunk of chunks) {
    tickets.push(...await expo.sendPushNotificationsAsync(chunk));
  }
  return tickets;
};
