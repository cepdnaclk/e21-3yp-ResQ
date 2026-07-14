package lk.resq.localhub.service;

import lk.resq.localhub.model.firmware.CalibrationProfileRecord;
import org.springframework.stereotype.Service;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Locale;

@Service
public class CalibrationProfileFingerprintService {

    public String computeHash(String profileId, int profileVersion, int hallDelta, int refPressure, int bladder1Pressure, int bladder2Pressure) {
        String canonicalString = String.format(Locale.US, "v1;%s;%d;%d;%d;%d;%d",
                profileId, profileVersion, hallDelta, refPressure, bladder1Pressure, bladder2Pressure);
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] hashBytes = digest.digest(canonicalString.getBytes(StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder();
            for (byte b : hashBytes) {
                sb.append(String.format("%02x", b));
            }
            return sb.toString();
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 algorithm not available", e);
        }
    }

    public String computeHash(CalibrationProfileRecord record) {
        return computeHash(record.profileId(), record.version(), record.hallDelta(), record.refPressure(), record.bladder1Pressure(), record.bladder2Pressure());
    }
}
