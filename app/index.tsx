//this is the landing screen of the app but it automatically redirects to /home, maybe add a timing factor and a nice load screen here or something

import { Redirect } from 'expo-router';

export default function Index() {
  return <Redirect href="/home" />;
}
