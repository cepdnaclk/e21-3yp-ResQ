package lk.resq.localhub.controller;

import jakarta.servlet.http.HttpServletRequest;
import lk.resq.localhub.model.ApiErrorResponse;
import lk.resq.localhub.model.AuthUser;
import lk.resq.localhub.model.UserRole;
import lk.resq.localhub.model.firmware.CalibrationProfileRequest;
import lk.resq.localhub.service.AuthService;
import lk.resq.localhub.service.CalibrationProfileService;
import lk.resq.localhub.service.ForbiddenException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

@RestController
@RequestMapping("/api/firmware/calibration-profiles")
public class CalibrationProfileController {

    private final CalibrationProfileService calibrationProfileService;
    private final AuthService authService;

    public CalibrationProfileController(CalibrationProfileService calibrationProfileService, AuthService authService) {
        this.calibrationProfileService = calibrationProfileService;
        this.authService = authService;
    }

    @GetMapping
    public ResponseEntity<?> listProfiles(HttpServletRequest request) {
        return runWithAuth(request, () -> ResponseEntity.ok(calibrationProfileService.listProfiles()));
    }

    @GetMapping("/default")
    public ResponseEntity<?> defaultProfile(HttpServletRequest request) {
        return runWithAuth(request, () -> ResponseEntity.ok(calibrationProfileService.getDefaultProfile().orElse(null)));
    }

    @PostMapping
    public ResponseEntity<?> createProfile(HttpServletRequest request, @RequestBody CalibrationProfileRequest body) {
        return runWithAuth(request, () -> {
            AuthUser actor = authService.requireRole(request, UserRole.INSTRUCTOR);
            var response = calibrationProfileService.createProfile(body);
            authService.audit(actor.id(), "FIRMWARE_CALIBRATION_PROFILE_CREATE", "firmware_profile", response.profileId(), Map.of("name", response.name()));
            return ResponseEntity.ok(response);
        });
    }

    @PutMapping("/{profileId}")
    public ResponseEntity<?> updateProfile(HttpServletRequest request, @PathVariable String profileId, @RequestBody CalibrationProfileRequest body) {
        return runWithAuth(request, () -> {
            AuthUser actor = authService.requireRole(request, UserRole.INSTRUCTOR);
            var response = calibrationProfileService.updateProfile(profileId, body);
            authService.audit(actor.id(), "FIRMWARE_CALIBRATION_PROFILE_UPDATE", "firmware_profile", response.profileId(), Map.of("name", response.name()));
            return ResponseEntity.ok(response);
        });
    }

    @PostMapping("/{profileId}/default")
    public ResponseEntity<?> setDefaultProfile(HttpServletRequest request, @PathVariable String profileId) {
        return runWithAuth(request, () -> {
            AuthUser actor = authService.requireRole(request, UserRole.INSTRUCTOR);
            var response = calibrationProfileService.setDefaultProfile(profileId);
            authService.audit(actor.id(), "FIRMWARE_CALIBRATION_PROFILE_SET_DEFAULT", "firmware_profile", response.profileId(), Map.of("name", response.name()));
            return ResponseEntity.ok(response);
        });
    }

    @DeleteMapping("/{profileId}")
    public ResponseEntity<?> deactivateProfile(HttpServletRequest request, @PathVariable String profileId) {
        return runWithAuth(request, () -> {
            AuthUser actor = authService.requireRole(request, UserRole.INSTRUCTOR);
            var response = calibrationProfileService.deleteOrDeactivateProfile(profileId);
            authService.audit(actor.id(), "FIRMWARE_CALIBRATION_PROFILE_DEACTIVATE", "firmware_profile", response.profileId(), Map.of("name", response.name()));
            return ResponseEntity.ok(response);
        });
    }

    private ResponseEntity<?> runWithAuth(HttpServletRequest request, ControllerAction action) {
        try {
            authService.requireRole(request, UserRole.INSTRUCTOR);
            return action.run();
        } catch (IllegalArgumentException error) {
            return ResponseEntity.badRequest().body(new ApiErrorResponse(error.getMessage()));
        } catch (ForbiddenException error) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).body(new ApiErrorResponse(error.getMessage()));
        }
    }

    @FunctionalInterface
    private interface ControllerAction {
        ResponseEntity<?> run();
    }
}