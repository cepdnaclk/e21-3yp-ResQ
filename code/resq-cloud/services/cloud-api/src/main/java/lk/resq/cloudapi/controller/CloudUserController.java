package lk.resq.cloudapi.controller;

import lk.resq.cloudapi.model.CloudUser;
import lk.resq.cloudapi.model.CreateCloudUserRequest;
import lk.resq.cloudapi.model.UpdateCloudPasswordRequest;
import lk.resq.cloudapi.model.UpdateLocalHubPasswordRequest;
import lk.resq.cloudapi.service.CloudManagementService;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/cloud/users")
public class CloudUserController {

    private final CloudManagementService service;

    public CloudUserController(CloudManagementService service) {
        this.service = service;
    }

    @PostMapping
    public ResponseEntity<CloudUser> create(@RequestBody CreateCloudUserRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED).body(service.createUser(request));
    }

    @GetMapping
    public List<CloudUser> list() {
        return service.listUsers();
    }

    @GetMapping("/{userId}")
    public CloudUser get(@PathVariable String userId) {
        return service.getUser(userId);
    }

    @PatchMapping("/{userId}")
    public CloudUser update(@PathVariable String userId, @RequestBody Map<String, Object> patch) {
        return service.updateUser(userId, patch);
    }

    @PatchMapping("/{userId}/password")
    public ResponseEntity<Void> updatePassword(
            @PathVariable String userId,
            @RequestBody UpdateCloudPasswordRequest request
    ) {
        service.updateUserPassword(userId, request);
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/{userId}/localhub-password")
    public ResponseEntity<CloudUser> setLocalHubPassword(
            @PathVariable String userId,
            @RequestBody UpdateLocalHubPasswordRequest request
    ) {
        CloudUser user = service.updateLocalHubPassword(userId, request);
        return ResponseEntity.ok(user);
    }
}
