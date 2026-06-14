package lk.resq.localhub.service;

import lk.resq.localhub.model.HubServiceInfoResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
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

    private static final Logger LOG = LoggerFactory.getLogger(HubServiceInfoService.class);

    private final int backendPort;
    private final String backendAdvertisedHost;
    private final String mqttBrokerUrl;
    private final String mqttAdvertisedHost;
    private final int mqttPort;
    private final String dashboardUrl;
    private final String activeProfile;

    public HubServiceInfoService(
            @Value("${server.port:18080}") int backendPort,
            @Value("${resq.localhub.backend.advertised-host:}") String backendAdvertisedHost,
            @Value("${resq.hub.public-host:}") String hubPublicHost,
            @Value("${resq.mqtt.broker-url:tcp://localhost:1883}") String mqttBrokerUrl,
            @Value("${resq.mqtt.advertised-host:}") String mqttAdvertisedHost,
            @Value("${resq.mqtt.public-host:}") String mqttPublicHost,
            @Value("${resq.mqtt.port:1883}") int mqttPort,
            @Value("${resq.localhub.dashboard-url:http://localhost:1420}") String dashboardUrl,
            @Value("${spring.profiles.active:}") String activeProfile
    ) {
        this.backendPort = backendPort;
        // Allow either resq.hub.public-host or resq.localhub.backend.advertised-host
        String chosenBackendHost = normalize(hubPublicHost) != null ? hubPublicHost : backendAdvertisedHost;
        this.backendAdvertisedHost = normalize(chosenBackendHost);
        // Internal broker URL used by the backend to connect
        this.mqttBrokerUrl = mqttBrokerUrl;
        // Allow either resq.mqtt.public-host or resq.mqtt.advertised-host for firmware-facing host
        String chosenMqttAdvertised = normalize(mqttPublicHost) != null ? mqttPublicHost : mqttAdvertisedHost;
        this.mqttAdvertisedHost = normalize(chosenMqttAdvertised);
        this.mqttPort = mqttPort;
        this.dashboardUrl = dashboardUrl;
        this.activeProfile = normalize(activeProfile);
    }

    public HubServiceInfoResponse serviceInfo() {
        Optional<String> localIp = detectLanIp();

        String backendHost;
        if (backendAdvertisedHost != null) {
            backendHost = backendAdvertisedHost;
        } else if (localIp.isPresent()) {
            backendHost = localIp.get();
        } else if ("release".equalsIgnoreCase(activeProfile)) {
            LOG.error("No usable LAN IP detected and no advertised backend host configured (release profile)");
            throw new IllegalStateException("No usable LAN IP detected and no advertised backend host configured");
        } else {
            backendHost = "127.0.0.1";
        }

        String mqttHost = mqttAdvertisedHost != null ? mqttAdvertisedHost : backendHost;
        int resolvedMqttPort = mqttPort > 0 ? mqttPort : inferPort(mqttBrokerUrl).orElse(1883);

        LOG.info("MQTT internal URL: {}", mqttBrokerUrl);
        LOG.info("MQTT advertised/public host: {}:{}", mqttHost, resolvedMqttPort);
        LOG.info("Backend advertised URL: http://{}:{}", backendHost, backendPort);

        return new HubServiceInfoResponse(
                true,
                "http://" + backendHost + ":" + backendPort,
                mqttHost,
                resolvedMqttPort,
                dashboardUrl,
                localIp.orElse(null)
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
