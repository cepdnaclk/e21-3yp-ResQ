package lk.resq.localhub.service;

import lk.resq.localhub.model.HubServiceInfoResponse;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.net.DatagramSocket;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.net.URI;
import java.util.Collections;
import java.util.Comparator;
import java.util.Enumeration;
import java.util.Optional;

@Service
public class HubServiceInfoService {

    private final int backendPort;
    private final String backendAdvertisedHost;
    private final String mqttBrokerUrl;
    private final String mqttAdvertisedHost;
    private final int mqttPort;
    private final String dashboardUrl;
    private final boolean cloudSyncEnabled;
    private final boolean rosterSyncEnabled;

    public HubServiceInfoService(
            @Value("${server.port:18080}") int backendPort,
            @Value("${resq.localhub.backend.advertised-host:}") String backendAdvertisedHost,
            @Value("${resq.mqtt.broker-url:tcp://localhost:1883}") String mqttBrokerUrl,
            @Value("${resq.mqtt.advertised-host:}") String mqttAdvertisedHost,
            @Value("${resq.mqtt.port:1883}") int mqttPort,
            @Value("${resq.localhub.dashboard-url:http://localhost:1420}") String dashboardUrl,
            @Value("${resq.cloud-sync.enabled:false}") boolean cloudSyncEnabled,
            @Value("${resq.roster-sync.enabled:false}") boolean rosterSyncEnabled
    ) {
        this.backendPort = backendPort;
        this.backendAdvertisedHost = normalize(backendAdvertisedHost);
        this.mqttBrokerUrl = mqttBrokerUrl;
        this.mqttAdvertisedHost = normalize(mqttAdvertisedHost);
        this.mqttPort = mqttPort;
        this.dashboardUrl = dashboardUrl;
        this.cloudSyncEnabled = cloudSyncEnabled;
        this.rosterSyncEnabled = rosterSyncEnabled;
    }

    public HubServiceInfoResponse serviceInfo() {
        String localIp = detectLanIp().orElse("127.0.0.1");
        String backendHost = backendAdvertisedHost != null ? backendAdvertisedHost : localIp;
        String mqttHost = mqttAdvertisedHost != null ? mqttAdvertisedHost : backendHost;
        int resolvedMqttPort = mqttPort > 0 ? mqttPort : inferPort(mqttBrokerUrl).orElse(1883);

        return new HubServiceInfoResponse(
                true,
                "http://" + backendHost + ":" + backendPort,
                mqttHost,
                resolvedMqttPort,
                dashboardUrl,
                localIp,
                cloudSyncEnabled,
                rosterSyncEnabled
        );
    }

    private static Optional<Integer> inferPort(String brokerUrl) {
        try {
            URI uri = URI.create(brokerUrl.replace("tcp://", "http://"));
            return uri.getPort() > 0 ? Optional.of(uri.getPort()) : Optional.empty();
        } catch (Exception ignored) {
            return Optional.empty();
        }
    }

    private static Optional<String> detectLanIp() {
        Optional<String> viaUdp = detectIpViaUdp();
        if (viaUdp.isPresent()) {
            return viaUdp;
        }

        try {
            Enumeration<NetworkInterface> interfaces = NetworkInterface.getNetworkInterfaces();
            return interfaces == null
                    ? Optional.empty()
                    : Collections.list(interfaces).stream()
                            .filter(HubServiceInfoService::usableInterface)
                            .flatMap(networkInterface -> networkInterface.getInterfaceAddresses().stream())
                            .map(address -> address.getAddress())
                            .filter(Inet4Address.class::isInstance)
                            .map(Inet4Address.class::cast)
                            .filter(HubServiceInfoService::usableAddress)
                            .max(Comparator.comparingInt(HubServiceInfoService::score))
                            .map(Inet4Address::getHostAddress);
        } catch (Exception ignored) {
            return Optional.empty();
        }
    }

    private static Optional<String> detectIpViaUdp() {
        try (DatagramSocket socket = new DatagramSocket()) {
            socket.connect(InetAddress.getByName("8.8.8.8"), 80);
            InetAddress address = socket.getLocalAddress();
            if (address instanceof Inet4Address ipv4 && usableAddress(ipv4)) {
                return Optional.of(ipv4.getHostAddress());
            }
        } catch (Exception ignored) {
        }
        return Optional.empty();
    }

    private static boolean usableInterface(NetworkInterface networkInterface) {
        try {
            return networkInterface.isUp() && !networkInterface.isLoopback() && !networkInterface.isVirtual();
        } catch (Exception ignored) {
            return false;
        }
    }

    private static boolean usableAddress(Inet4Address address) {
        return !address.isLoopbackAddress() && !address.isAnyLocalAddress() && !address.isLinkLocalAddress();
    }

    private static int score(Inet4Address address) {
        byte[] octets = address.getAddress();
        int first = octets[0] & 0xff;
        int second = octets[1] & 0xff;
        if (first == 10 || (first == 172 && second >= 16 && second <= 31) || (first == 192 && second == 168)) {
            return 100;
        }
        return 0;
    }

    private static String normalize(String value) {
        if (value == null) {
            return null;
        }
        String trimmed = value.trim();
        return trimmed.isEmpty() ? null : trimmed;
    }
}
