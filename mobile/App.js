import { StatusBar } from 'expo-status-bar';
import { useRef, useState } from 'react';
import {
  ActivityIndicator,
  SafeAreaView,
  StyleSheet,
  View,
} from 'react-native';
import { WebView } from 'react-native-webview';

const CRM_URL = 'https://comfy-cheesecake-17a165.netlify.app';

export default function App() {
  const webViewRef = useRef(null);
  const [loading, setLoading] = useState(true);

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="dark" backgroundColor="#f9f6f1" />
      {loading && (
        <View style={styles.loader}>
          <ActivityIndicator size="large" color="#d4a843" />
        </View>
      )}
      <WebView
        ref={webViewRef}
        source={{ uri: CRM_URL }}
        style={styles.webview}
        onLoadEnd={() => setLoading(false)}
        javaScriptEnabled
        domStorageEnabled
        allowsBackForwardNavigationGestures
        pullToRefreshEnabled
        cacheEnabled
        sharedCookiesEnabled
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f9f6f1',
  },
  webview: {
    flex: 1,
  },
  loader: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f9f6f1',
  },
});
