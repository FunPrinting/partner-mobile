import React, { useState, useEffect, useRef } from 'react';
import { StyleSheet, Text, View, TextInput, TouchableOpacity, SafeAreaView, StatusBar, ScrollView, Alert, ActivityIndicator, Image, Switch } from 'react-native';
import io from 'socket.io-client';
import * as Print from 'expo-print';
import * as SecureStore from 'expo-secure-store';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import * as FileSystem from 'expo-file-system';
import * as IntentLauncher from 'expo-intent-launcher';
import Constants from 'expo-constants';
import * as Location from 'expo-location';
import MapView, { Marker } from 'react-native-maps';
import { Modal } from 'react-native';

export default function App() {
  const [partnerId, setPartnerId] = useState('');
  const [token, setToken] = useState('');
  const [isConnected, setIsConnected] = useState(false);
  const [socket, setSocket] = useState(null);
  const [liveQueue, setLiveQueue] = useState([]);
  const [isBooting, setIsBooting] = useState(true);
  const [financials, setFinancials] = useState({ todayEarnings: 0, totalEarnings: 0, completedOrdersCount: 0 });
  
  // Phase 6: Direct Mobile Print Server States
  const [appMode, setAppMode] = useState('remote'); // 'remote' or 'server'
  const [printerIp, setPrinterIp] = useState('192.168.1.100');
  const appModeRef = useRef('remote');
  const printerIpRef = useRef('192.168.1.100');

  // Phase 7: Update Checking
  const [updateStatus, setUpdateStatus] = useState('Check for Updates');

  // Shop Profile Management
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [shopLocation, setShopLocation] = useState({ latitude: 28.6139, longitude: 77.2090 });
  const [searchQuery, setSearchQuery] = useState('');
  const [isLocating, setIsLocating] = useState(false);
  const [shopPricing, setShopPricing] = useState({ bw: '2', color: '10', binding: '40' });
  const [isOnline, setIsOnline] = useState(false);
  const [isLoadingProfile, setIsLoadingProfile] = useState(false);

  const [showOrdersModal, setShowOrdersModal] = useState(false);
  const [ordersList, setOrdersList] = useState([]);
  const [isLoadingOrders, setIsLoadingOrders] = useState(false);

  const loadOrdersAndShow = async () => {
    setIsLoadingOrders(true);
    setShowOrdersModal(true);
    try {
      const res = await fetch('https://www.funprinting.store/api/partner/orders', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.success) {
        setOrdersList(data.orders);
      }
    } catch (e) {
      Alert.alert('Error', 'Failed to load orders.');
    } finally {
      setIsLoadingOrders(false);
    }
  };

  const updateOrderStatus = async (orderId, newStatus) => {
    try {
      const res = await fetch(`https://www.funprinting.store/api/partner/orders/${orderId}`, {
        method: 'PATCH',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ status: newStatus })
      });
      if (res.ok) {
        loadOrdersAndShow(); // refresh
      } else {
        Alert.alert('Error', 'Failed to update order status');
      }
    } catch (e) {
      Alert.alert('Error', 'Network error');
    }
  };

  const loadProfileAndShow = async () => {
    setIsLoadingProfile(true);
    try {
      const res = await fetch('https://www.funprinting.store/api/partner/profile', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.success && data.partner) {
        if (data.partner.location && data.partner.location.coordinates) {
          setShopLocation({ latitude: data.partner.location.coordinates[1], longitude: data.partner.location.coordinates[0] });
        }
        if (data.partner.pricing) {
          setShopPricing({ bw: data.partner.pricing.perPageBW.toString(), color: data.partner.pricing.perPageColor.toString(), binding: data.partner.pricing.binding.toString() });
        }
        if (data.partner.isOnline !== undefined) {
          setIsOnline(data.partner.isOnline);
        }
      }
      setShowProfileModal(true);
    } catch (e) {
      Alert.alert('Error', 'Failed to load profile.');
      setShowProfileModal(true); // show anyway
    } finally {
      setIsLoadingProfile(false);
    }
  };

  const checkForUpdates = async () => {
    try {
      setUpdateStatus('Checking...');
      const response = await fetch('https://api.github.com/repos/FunPrinting/partner-mobile/releases/latest', {
        headers: {
          'User-Agent': 'FunPrinting-Partner-App',
          'Accept': 'application/vnd.github.v3+json'
        }
      });
      if (!response.ok) throw new Error(`GitHub API returned ${response.status}`);
      const data = await response.json();
      const latestVersion = data.tag_name;
      
      const currentVersion = `v${Constants.expoConfig?.version || '1.0.0'}`;
      
      if (latestVersion && latestVersion !== currentVersion) {
        setUpdateStatus(`Update Found (${latestVersion})! Downloading...`);
        const apkAsset = data.assets.find(a => a.name.endsWith('.apk'));
        if (apkAsset) {
          const downloadUrl = apkAsset.browser_download_url;
          const fileUri = `${FileSystem.documentDirectory}update.apk`;
          
          await FileSystem.downloadAsync(downloadUrl, fileUri);
          setUpdateStatus('Installing...');
          
          const contentUri = await FileSystem.getContentUriAsync(fileUri);
          await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
            data: contentUri,
            flags: 1,
            type: 'application/vnd.android.package-archive'
          });
          setUpdateStatus('Check for Updates');
        } else {
          setUpdateStatus('Error: No APK found');
          setTimeout(() => setUpdateStatus('Check for Updates'), 3000);
        }
      } else {
        setUpdateStatus('App is up to date');
        setTimeout(() => setUpdateStatus('Check for Updates'), 3000);
      }
    } catch (e) {
      console.error(e);
      setUpdateStatus('Update Check Failed');
      setTimeout(() => setUpdateStatus('Check for Updates'), 3000);
    }
  };

  // Phase 2: Silent persistence loading on boot
  useEffect(() => {
    const loadSession = async () => {
      try {
        const storedPartnerId = await SecureStore.getItemAsync('partnerId');
        const storedToken = await SecureStore.getItemAsync('token');
        if (storedPartnerId && storedToken) {
          setPartnerId(storedPartnerId);
          setToken(storedToken);
          setIsConnected(true);
          // Auto-connect if we have a cached session
          establishConnection(storedPartnerId, storedToken);
        }
      } catch (e) {
        console.error('Failed to load session:', e);
      } finally {
        setIsBooting(false);
      }
    };
    loadSession();

    return () => {
      if (socket) socket.disconnect();
    };
  }, []);

  const establishConnection = (pid, jwt) => {
    // Phase 3: Real WebSocket Tunnel Connection
    const newSocket = io('https://funprinting-wss.onrender.com', {
      auth: { token: jwt },
      query: { partnerId: pid }
    });

    newSocket.on('connect', () => {
      setIsConnected(true);
      setSocket(newSocket);
      
      // Phase 5: Fetch Financial Dashboard Data
      fetch('https://www.funprinting.store/api/partner/financials', {
        headers: { 'Authorization': `Bearer ${jwt}` }
      })
      .then(res => res.json())
      .then(data => {
        if(data.success && data.financials) {
          setFinancials(data.financials);
        }
      })
      .catch(err => console.error("Failed to fetch financials:", err));
    });

    newSocket.on('connect_error', (err) => {
      Alert.alert("Connection Failed", "Unable to establish secure tunnel to Cloud.");
      setIsConnected(false);
      setIsBooting(false);
    });

    newSocket.on('new_print_job', async (job) => {
      setLiveQueue(prev => [job, ...prev]);
      
      const currentMode = appModeRef.current;
      
      if (currentMode === 'remote') {
        // Remote Control Mode: Don't do anything physical, just show in queue.
        return;
      }

      // Phase 6: Autonomous Mobile Print Server Mode
      try {
        console.log(`Phase 6: Emulating Direct IP Print to ${printerIpRef.current}:9100`);
        
        const hasMultipleFiles = job.fileURLs && job.fileURLs.length > 0;
        
        if (hasMultipleFiles) {
          for (let i = 0; i < job.fileURLs.length; i++) {
             await Print.printAsync({
               uri: job.fileURLs[i],
               printerUrl: undefined,
             });
          }
        } else {
          await Print.printAsync({
            uri: job.documentUrl,
            printerUrl: undefined, // Simulates direct connection
          });
        }
        
        newSocket.emit('print_job_ack', { jobId: job.jobId, status: 'success' });
      } catch (error) {
        newSocket.emit('print_job_ack', { jobId: job.jobId, status: 'error', error: error.message });
        Alert.alert("Print Failed", "Ensure your Android device is on the same WiFi as the printer.");
      }
    });
    newSocket.on('system_alert', (data) => {
      // Phase 5: Push Notifications for Paper Jams / High-Value Orders
      Alert.alert(
        data.title || "System Alert",
        data.message || "An event occurred on the PC Print Engine."
      );
    });
  };

  const handleGoogleAuth = async () => {
    try {
      const redirectUrl = Linking.createURL('callback');
      const authUrl = `https://www.funprinting.store/partner/desktop-auth?callback=${encodeURIComponent(redirectUrl)}`;
      
      const result = await WebBrowser.openAuthSessionAsync(authUrl, redirectUrl);
      
      if (result.type === 'success' && result.url) {
        const parsed = Linking.parse(result.url);
        const pid = parsed.queryParams?.partnerId;
        const jwt = parsed.queryParams?.token;
        
        if (pid && jwt) {
          setPartnerId(pid);
          setToken(jwt);
          await SecureStore.setItemAsync('partnerId', pid);
          await SecureStore.setItemAsync('token', jwt);
          establishConnection(pid, jwt);
        } else {
          Alert.alert("Auth Error", "Failed to retrieve token from login.");
        }
      }
    } catch (e) {
      console.error(e);
      Alert.alert("Auth Error", "Something went wrong during login.");
    }
  };

  const handleDisconnect = async () => {
    if (socket) socket.disconnect();
    try {
      await SecureStore.deleteItemAsync('partnerId');
      await SecureStore.deleteItemAsync('token');
    } catch (e) {
      console.error('Failed to clear session:', e);
    }
    setIsConnected(false);
    setSocket(null);
  };

  if (isBooting) {
    return (
      <View style={{ flex: 1, backgroundColor: '#F9FAFB', justifyContent: 'center', alignItems: 'center' }}>
        <StatusBar barStyle="light-content" backgroundColor="#111827" />
        <ActivityIndicator size="large" color="#3B82F6" />
        <Text style={{ color: '#111827', marginTop: 16 }}>Loading Business Tools...</Text>
      </View>
    );
  }

  if (isConnected) {
    return (
      <SafeAreaView style={styles.container}>
        <StatusBar barStyle="light-content" backgroundColor="#111827" />
        
        {/* Header */}
        <View style={styles.header}>
          <Image source={require('./assets/logo.jpg')} style={styles.headerLogoImage} />
          <Text style={styles.headerTitle}>Partner Mobile</Text>
          <View style={styles.statusBadge}>
            <View style={styles.statusDot} />
            <Text style={styles.statusText}>Online</Text>
          </View>
        </View>

        <ScrollView style={styles.mainContent}>
          {/* Phase 5: Shopkeeper Financial Dashboard */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Today's Earnings (90% Split)</Text>
            <Text style={styles.earningsText}>₹ {financials.todayEarnings.toLocaleString()}</Text>
            
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 16, borderTopWidth: 1, borderTopColor: '#E5E7EB', paddingTop: 16 }}>
              <View>
                <Text style={{ color: '#6B7280', fontSize: 12 }}>All-Time Revenue</Text>
                <Text style={{ color: '#F3F4F6', fontSize: 16, fontWeight: 'bold' }}>₹ {financials.totalEarnings.toLocaleString()}</Text>
              </View>
              <View>
                <Text style={{ color: '#6B7280', fontSize: 12 }}>Total Orders</Text>
                <Text style={{ color: '#F3F4F6', fontSize: 16, fontWeight: 'bold' }}>{financials.completedOrdersCount}</Text>
              </View>
            </View>
          </View>

          {/* Phase 5: Remote Control for PC Spooler */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>App Operation Mode</Text>
            <View style={{ flexDirection: 'row', gap: 12, marginBottom: 12 }}>
              <TouchableOpacity 
                style={[styles.btn, { flex: 1, backgroundColor: appMode === 'remote' ? '#4F46E5' : '#374151' }]}
                onPress={() => { setAppMode('remote'); appModeRef.current = 'remote'; }}
              >
                <Text style={styles.btnText}>PC Remote</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={[styles.btn, { flex: 1, backgroundColor: appMode === 'server' ? '#4F46E5' : '#374151' }]}
                onPress={() => { setAppMode('server'); appModeRef.current = 'server'; }}
              >
                <Text style={styles.btnText}>Direct Server</Text>
              </TouchableOpacity>
            </View>
            
            {appMode === 'server' && (
              <View style={styles.formGroup}>
                <Text style={styles.label}>WiFi Printer IP (Port 9100)</Text>
                <TextInput
                  style={styles.input}
                  value={printerIp}
                  onChangeText={(val) => { setPrinterIp(val); printerIpRef.current = val; }}
                  placeholder="192.168.1.x"
                  placeholderTextColor="#6B7280"
                />
              </View>
            )}

            {appMode === 'remote' && (
               <View>
                 <Text style={styles.cardTitle}>PC Engine Remote Control</Text>
                 <View style={{ flexDirection: 'row', gap: 12 }}>
                   <TouchableOpacity 
                     style={[styles.btn, { flex: 1, backgroundColor: '#DC2626' }]}
                     onPress={() => socket.emit('remote_control', { action: 'pause' })}
                   >
                     <Text style={styles.btnText}>Pause PC Queue</Text>
                   </TouchableOpacity>
                   <TouchableOpacity 
                     style={[styles.btn, { flex: 1, backgroundColor: '#10B981' }]}
                     onPress={() => socket.emit('remote_control', { action: 'resume' })}
                   >
                     <Text style={styles.btnText}>Resume PC</Text>
                   </TouchableOpacity>
                 </View>
               </View>
            )}
          </View>

          {/* Queue */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Live Mobile Print Queue</Text>
            {liveQueue.length === 0 ? (
              <View style={styles.emptyQueue}>
                <Text style={styles.emptyQueueText}>Waiting for orders via WebSockets...</Text>
              </View>
            ) : (
              liveQueue.map((job, index) => (
                <View key={index} style={styles.jobItem}>
                  <Text style={styles.jobId}>Job #{job.jobId.substring(0,6)}</Text>
                  <Text style={styles.jobStatus}>Sent to Android Spooler</Text>
                </View>
              ))
            )}
          </View>

          {/* System Settings */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>System Settings</Text>
            <Text style={{ color: '#6B7280', fontSize: 12, marginBottom: 12 }}>
              Current Version: {Constants.expoConfig?.version || '1.0.0'}
            </Text>
            <TouchableOpacity 
              style={[styles.btn, { backgroundColor: '#374151', padding: 12 }]}
              onPress={checkForUpdates}
            >
              <Text style={styles.btnText}>{updateStatus}</Text>
            </TouchableOpacity>
            
            <TouchableOpacity 
              style={[styles.btn, { backgroundColor: '#4F46E5', padding: 12, marginTop: 12 }]}
              onPress={loadProfileAndShow}
              disabled={isLoadingProfile}
            >
              <Text style={styles.btnText}>{isLoadingProfile ? 'Loading...' : 'Manage Shop Profile'}</Text>
            </TouchableOpacity>

            <TouchableOpacity 
              style={[styles.btn, { backgroundColor: '#10B981', padding: 12, marginTop: 12 }]}
              onPress={loadOrdersAndShow}
              disabled={isLoadingOrders}
            >
              <Text style={styles.btnText}>{isLoadingOrders ? 'Loading...' : 'Manage Orders'}</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity style={styles.logoutBtn} onPress={handleDisconnect}>
            <Text style={styles.logoutBtnText}>Disconnect Mobile Session</Text>
          </TouchableOpacity>
        </ScrollView>

        {/* Shop Location Map Modal */}
        <Modal visible={showProfileModal} animationType="slide" transparent={true}>
          <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}>
            <View style={{ backgroundColor: '#FFFFFF', height: '95%', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                <Text style={{ color: '#111827', fontSize: 20, fontWeight: 'bold' }}>Update Shop Profile</Text>
                <TouchableOpacity onPress={() => setShowProfileModal(false)}>
                  <Text style={{ color: '#6B7280', fontSize: 16 }}>Close</Text>
                </TouchableOpacity>
              </View>

              <ScrollView style={{ flex: 1, marginBottom: 16 }} showsVerticalScrollIndicator={false}>
                
                {/* Status Toggle */}
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, backgroundColor: '#374151', padding: 16, borderRadius: 12 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: '#111827', fontSize: 16, fontWeight: 'bold' }}>Taking Orders</Text>
                    <Text style={{ color: '#6B7280', fontSize: 12, marginTop: 4 }}>Turn on to appear on the customer map</Text>
                  </View>
                  <Switch
                    trackColor={{ false: '#4B5563', true: '#10B981' }}
                    thumbColor={isOnline ? '#FFFFFF' : '#D1D5DB'}
                    onValueChange={setIsOnline}
                    value={isOnline}
                  />
                </View>

                {/* Pricing Fields */}
                <Text style={{ color: '#4B5563', fontSize: 14, fontWeight: 'bold', marginBottom: 8 }}>Service Pricing (₹)</Text>
                <View style={{ flexDirection: 'row', gap: 10, marginBottom: 20 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: '#6B7280', fontSize: 12, marginBottom: 4 }}>B&W (Per Page)</Text>
                    <TextInput style={[styles.input, { padding: 10, fontSize: 14 }]} value={shopPricing.bw} onChangeText={(val) => setShopPricing({...shopPricing, bw: val})} keyboardType="numeric" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: '#6B7280', fontSize: 12, marginBottom: 4 }}>Color (Per Page)</Text>
                    <TextInput style={[styles.input, { padding: 10, fontSize: 14 }]} value={shopPricing.color} onChangeText={(val) => setShopPricing({...shopPricing, color: val})} keyboardType="numeric" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: '#6B7280', fontSize: 12, marginBottom: 4 }}>Binding (Fixed)</Text>
                    <TextInput style={[styles.input, { padding: 10, fontSize: 14 }]} value={shopPricing.binding} onChangeText={(val) => setShopPricing({...shopPricing, binding: val})} keyboardType="numeric" />
                  </View>
                </View>

                {/* Map Search & GPS */}
                <Text style={{ color: '#4B5563', fontSize: 14, fontWeight: 'bold', marginBottom: 8 }}>Shop Location</Text>
                <View style={{ flexDirection: 'row', gap: 10, marginBottom: 16 }}>
                <TextInput
                  style={[styles.input, { flex: 1, padding: 12, fontSize: 14 }]}
                  placeholder="Search city/address..."
                  placeholderTextColor="#6B7280"
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                  onSubmitEditing={async () => {
                    if (!searchQuery) return;
                    try {
                      const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(searchQuery)}`);
                      const data = await res.json();
                      if (data && data.length > 0) {
                        setShopLocation({ latitude: parseFloat(data[0].lat), longitude: parseFloat(data[0].lon) });
                      } else {
                        Alert.alert('Not Found', 'Location not found.');
                      }
                    } catch (e) {
                      Alert.alert('Error', 'Search failed.');
                    }
                  }}
                />
                <TouchableOpacity 
                  style={[styles.btn, { marginTop: 0, paddingHorizontal: 16, justifyContent: 'center' }]}
                  onPress={async () => {
                    if (!searchQuery) return;
                    try {
                      const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(searchQuery)}`);
                      const data = await res.json();
                      if (data && data.length > 0) {
                        setShopLocation({ latitude: parseFloat(data[0].lat), longitude: parseFloat(data[0].lon) });
                      } else {
                        Alert.alert('Not Found', 'Location not found.');
                      }
                    } catch (e) {
                      Alert.alert('Error', 'Search failed.');
                    }
                  }}
                >
                  <Text style={styles.btnText}>Search</Text>
                </TouchableOpacity>
                <TouchableOpacity 
                  style={[styles.btn, { marginTop: 0, paddingHorizontal: 16, justifyContent: 'center', backgroundColor: '#10B981' }]}
                  onPress={async () => {
                    setIsLocating(true);
                    try {
                      let { status } = await Location.requestForegroundPermissionsAsync();
                      
                      const useIP = async () => {
                        const res = await fetch('https://ipwho.is/');
                        const data = await res.json();
                        if (data && data.success) {
                           setShopLocation({ latitude: data.latitude, longitude: data.longitude });
                        }
                      };

                      if (status !== 'granted') {
                        Alert.alert('Permission Denied', 'Falling back to IP Location.');
                        await useIP();
                        setIsLocating(false);
                        return;
                      }
                      
                      let location = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
                      setShopLocation({ latitude: location.coords.latitude, longitude: location.coords.longitude });
                    } catch (e) {
                      console.log('GPS error, falling back to IP');
                      try {
                        const res = await fetch('https://ipwho.is/');
                        const data = await res.json();
                        if (data && data.success) setShopLocation({ latitude: data.latitude, longitude: data.longitude });
                      } catch(err) {}
                    } finally {
                      setIsLocating(false);
                    }
                  }}
                >
                  <Text style={styles.btnText}>{isLocating ? '...' : 'GPS'}</Text>
                </TouchableOpacity>
              </View>

              <View style={{ height: 350, borderRadius: 12, overflow: 'hidden', marginBottom: 20 }}>
                <MapView 
                  style={{ flex: 1 }}
                  region={{
                    latitude: shopLocation.latitude,
                    longitude: shopLocation.longitude,
                    latitudeDelta: 0.05,
                    longitudeDelta: 0.05,
                  }}
                  onPress={(e) => setShopLocation(e.nativeEvent.coordinate)}
                >
                  <Marker coordinate={shopLocation} />
                </MapView>
              </View>
              
              <Text style={{ color: '#6B7280', fontSize: 12, textAlign: 'center', marginBottom: 20 }}>
                Tap anywhere on the map to place the marker exactly on your shop.
              </Text>

              <TouchableOpacity 
                style={[styles.btn, { backgroundColor: '#10B981' }]}
                onPress={async () => {
                  try {
                    // Update location on backend
                    const res = await fetch(`https://www.funprinting.store/api/partner/profile`, {
                      method: 'PUT',
                      headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                      },
                      body: JSON.stringify({
                        location: {
                           type: 'Point',
                           coordinates: [shopLocation.longitude, shopLocation.latitude]
                        },
                        pricing: {
                           perPageBW: parseFloat(shopPricing.bw) || 2,
                           perPageColor: parseFloat(shopPricing.color) || 10,
                           binding: parseFloat(shopPricing.binding) || 40
                        },
                        isOnline: isOnline
                      })
                    });
                    
                    if (res.ok) {
                      Alert.alert('Success', 'Shop location updated successfully!');
                      setShowProfileModal(false);
                    } else {
                      Alert.alert('Error', 'Failed to update location.');
                    }
                  } catch (e) {
                    Alert.alert('Error', 'Network error.');
                  }
                }}
              >
                <Text style={styles.btnText}>Save Exact Location</Text>
              </TouchableOpacity>
              </ScrollView>
            </View>
          </View>
        </Modal>

        {/* Orders Modal */}
        <Modal visible={showOrdersModal} animationType="slide" transparent={true}>
          <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}>
            <View style={{ backgroundColor: '#FFFFFF', height: '90%', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                <Text style={{ color: '#111827', fontSize: 20, fontWeight: 'bold' }}>Order Management</Text>
                <TouchableOpacity onPress={() => setShowOrdersModal(false)}>
                  <Text style={{ color: '#6B7280', fontSize: 16 }}>Close</Text>
                </TouchableOpacity>
              </View>

              <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
                {isLoadingOrders ? (
                  <ActivityIndicator size="large" color="#4F46E5" style={{ marginTop: 50 }} />
                ) : ordersList.length === 0 ? (
                  <View style={{ alignItems: 'center', justifyContent: 'center', marginTop: 40, paddingHorizontal: 20 }}>
                    <View style={{ backgroundColor: '#EEF2FF', padding: 16, borderRadius: 50, marginBottom: 16 }}>
                      <Text style={{ fontSize: 32 }}>📭</Text>
                    </View>
                    <Text style={{ fontSize: 18, fontWeight: 'bold', color: '#111827', marginBottom: 8 }}>No active orders yet</Text>
                    <Text style={{ fontSize: 14, color: '#6B7280', textAlign: 'center', lineHeight: 20 }}>
                      When customers place print jobs in your area, they will appear here. Keep your shop online to start receiving orders.
                    </Text>
                  </View>
                ) : (
                  ordersList.map(order => (
                    <View key={order.orderId} style={{ backgroundColor: '#374151', padding: 16, borderRadius: 12, marginBottom: 12 }}>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}>
                        <Text style={{ color: '#111827', fontWeight: 'bold' }}>Order #{order.orderId.substring(0,8)}</Text>
                        <Text style={{ color: '#10B981', fontWeight: 'bold' }}>₹{(order.amount * 0.9).toFixed(2)}</Text>
                      </View>
                      <Text style={{ color: '#4B5563', fontSize: 14, marginBottom: 4 }}>{order.originalFileName || 'Document'}</Text>
                      <Text style={{ color: '#6B7280', fontSize: 12, marginBottom: 12 }}>{new Date(order.createdAt).toLocaleDateString()}</Text>
                      
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Text style={{ 
                          color: order.status === 'completed' ? '#10B981' : order.status === 'ready_for_pickup' ? '#F59E0B' : '#60A5FA', 
                          fontWeight: 'bold', fontSize: 12 
                        }}>
                          {order.status.toUpperCase()}
                        </Text>
                        
                        {order.status !== 'completed' && (
                          <View style={{ flexDirection: 'row', gap: 8 }}>
                            {order.status === 'pending' && (
                              <TouchableOpacity onPress={() => updateOrderStatus(order.orderId, 'printing')} style={{ backgroundColor: '#3B82F6', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6 }}>
                                <Text style={{ color: 'white', fontSize: 12, fontWeight: 'bold' }}>Start Printing</Text>
                              </TouchableOpacity>
                            )}
                            {order.status === 'printing' && (
                              <TouchableOpacity onPress={() => updateOrderStatus(order.orderId, 'ready_for_pickup')} style={{ backgroundColor: '#F59E0B', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6 }}>
                                <Text style={{ color: 'white', fontSize: 12, fontWeight: 'bold' }}>Mark Ready</Text>
                              </TouchableOpacity>
                            )}
                            {order.status === 'ready_for_pickup' && (
                              <TouchableOpacity onPress={() => updateOrderStatus(order.orderId, 'completed')} style={{ backgroundColor: '#10B981', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6 }}>
                                <Text style={{ color: 'white', fontSize: 12, fontWeight: 'bold' }}>Complete</Text>
                              </TouchableOpacity>
                            )}
                          </View>
                        )}
                      </View>
                    </View>
                  ))
                )}
              </ScrollView>
            </View>
          </View>
        </Modal>

      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#111827" />
      <View style={styles.loginContainer}>
        <Image source={require('./assets/logo.jpg')} style={styles.loginLogoImage} />
        <Text style={styles.loginTitle}>FunPrinting Partner</Text>
        <Text style={styles.loginSubtitle}>Connect your Android device to receive printing jobs securely.</Text>

        <TouchableOpacity style={styles.btn} onPress={handleGoogleAuth}>
          <Text style={styles.btnText}>Sign In with Google</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F9FAFB', // Gray 900
  },
  loginContainer: {
    flex: 1,
    padding: 24,
    justifyContent: 'center',
  },
  loginLogoImage: {
    width: 64,
    height: 64,
    borderRadius: 16,
    marginBottom: 24,
  },
  loginTitle: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#111827',
    marginBottom: 8,
  },
  loginSubtitle: {
    fontSize: 16,
    color: '#6B7280', // Gray 400
    marginBottom: 32,
    lineHeight: 24,
  },
  formGroup: {
    marginBottom: 20,
  },
  label: {
    color: '#4B5563', // Gray 300
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 8,
  },
  input: {
    backgroundColor: '#FFFFFF', // Gray 800
    borderWidth: 1,
    borderColor: '#E5E7EB', // Gray 700
    borderRadius: 12,
    padding: 16,
    color: '#111827',
    fontSize: 16,
  },
  btn: {
    backgroundColor: '#4F46E5', // Indigo 600
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 12,
  },
  btnText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: 'bold',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  headerLogoImage: {
    width: 32,
    height: 32,
    borderRadius: 8,
    marginRight: 12,
  },
  headerTitle: {
    color: '#111827',
    fontSize: 18,
    fontWeight: 'bold',
    flex: 1,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.2)',
  },
  statusDot: {
    width: 8,
    height: 8,
    backgroundColor: '#10B981', // Emerald 500
    borderRadius: 4,
    marginRight: 6,
  },
  statusText: {
    color: '#10B981',
    fontSize: 12,
    fontWeight: 'bold',
  },
  mainContent: {
    flex: 1,
    padding: 16,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  cardTitle: {
    color: '#6B7280',
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 12,
  },
  earningsText: {
    color: '#111827',
    fontSize: 32,
    fontWeight: 'bold',
  },
  emptyQueue: {
    height: 120,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F9FAFB',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderStyle: 'dashed',
  },
  emptyQueueText: {
    color: '#6B7280',
  },
  jobItem: {
    backgroundColor: '#374151',
    padding: 12,
    borderRadius: 8,
    marginBottom: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  jobId: {
    color: '#111827',
    fontWeight: 'bold',
  },
  jobStatus: {
    color: '#10B981',
    fontSize: 12,
  },
  logoutBtn: {
    backgroundColor: '#374151',
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 8,
    marginBottom: 32,
  },
  logoutBtnText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: 'bold',
  }
});
